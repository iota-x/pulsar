use anchor_lang::prelude::*;

declare_id!("3UDvaK5Xxa7JsGUF3peRzbgspk5ASUQxCQEfhibj7Rjs");

/// Web3 Zapier on-chain program.
///
/// Backs the platform's on-chain "write" actions:
///   - `update_data` → an authority-owned key/value data feed (PDA). Powers the
///      `update_oracle_data` and `update_contract_state` worker actions.
///   - `ping`        → emits a Triggered event. Powers `trigger_smart_contract`.
#[program]
pub mod web3_zapier {
    use super::*;

    /// Create (first call) or update an authority's data feed for `key`.
    pub fn update_data(ctx: Context<UpdateData>, key: String, value: String) -> Result<()> {
        require!(key.as_bytes().len() <= MAX_KEY_LEN, FeedError::KeyTooLong);
        require!(value.as_bytes().len() <= MAX_VALUE_LEN, FeedError::ValueTooLong);

        let feed = &mut ctx.accounts.feed;
        feed.authority = ctx.accounts.authority.key();
        feed.key = key.clone();
        feed.value = value.clone();
        feed.updated_at = Clock::get()?.unix_timestamp;
        feed.update_count = feed.update_count.checked_add(1).unwrap();
        feed.bump = ctx.bumps.feed;

        emit!(DataUpdated {
            authority: feed.authority,
            key,
            value,
            update_count: feed.update_count,
            updated_at: feed.updated_at,
        });
        Ok(())
    }

    /// Emit a Triggered event — a verifiable on-chain "fire" of the contract.
    pub fn ping(ctx: Context<Ping>, label: String) -> Result<()> {
        require!(label.as_bytes().len() <= 64, FeedError::ValueTooLong);
        emit!(Triggered {
            signer: ctx.accounts.signer.key(),
            label,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    // --- Governance -------------------------------------------------------

    /// Create a governance proposal (PDA per authority + id).
    pub fn create_proposal(ctx: Context<CreateProposal>, id: String, description: String) -> Result<()> {
        require!(id.as_bytes().len() <= MAX_KEY_LEN, FeedError::KeyTooLong);
        require!(description.as_bytes().len() <= MAX_VALUE_LEN, FeedError::ValueTooLong);

        let p = &mut ctx.accounts.proposal;
        p.authority = ctx.accounts.authority.key();
        p.id = id.clone();
        p.description = description;
        p.yes_votes = 0;
        p.no_votes = 0;
        p.executed = false;
        p.created_at = Clock::get()?.unix_timestamp;
        p.bump = ctx.bumps.proposal;

        emit!(ProposalCreated { authority: p.authority, id });
        Ok(())
    }

    /// Cast a vote on a proposal (approve = yes, otherwise no).
    pub fn cast_vote(ctx: Context<CastVote>, approve: bool) -> Result<()> {
        let p = &mut ctx.accounts.proposal;
        require!(!p.executed, GovError::AlreadyExecuted);
        if approve {
            p.yes_votes = p.yes_votes.checked_add(1).unwrap();
        } else {
            p.no_votes = p.no_votes.checked_add(1).unwrap();
        }
        emit!(VoteCast { voter: ctx.accounts.voter.key(), approve, yes_votes: p.yes_votes, no_votes: p.no_votes });
        Ok(())
    }

    /// Execute a passed proposal (yes > no). Only the proposal authority may execute.
    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        let p = &mut ctx.accounts.proposal;
        require!(!p.executed, GovError::AlreadyExecuted);
        require!(p.yes_votes > p.no_votes, GovError::NotPassed);
        p.executed = true;
        emit!(ProposalExecuted { authority: p.authority, id: p.id.clone(), yes_votes: p.yes_votes, no_votes: p.no_votes });
        Ok(())
    }

    // --- Delegated transfers (non-custodial automation) -------------------

    /// Record a user's bounded delegation: `operator` may transfer up to
    /// `max_amount` of `mint` from the owner's token account until `expiry`
    /// (0 = no expiry). If `period_seconds > 0`, `max_amount` is a *rolling
    /// per-period* cap (e.g. max-per-day) that resets each window — limiting the
    /// blast radius if the operator is ever compromised; if 0 it's a single
    /// lifetime cap. The matching SPL `approve` (owner → authority PDA) is sent
    /// by the owner in the same transaction.
    pub fn create_delegation(
        ctx: Context<CreateDelegation>,
        max_amount: u64,
        expiry: i64,
        period_seconds: i64,
        operator: Pubkey,
        recipients: Vec<Pubkey>,
    ) -> Result<()> {
        require!(recipients.len() <= MAX_RECIPIENTS, DelegationError::TooManyRecipients);
        require!(period_seconds >= 0, DelegationError::InvalidPeriod);
        let now = Clock::get()?.unix_timestamp;
        let d = &mut ctx.accounts.delegation;
        d.owner = ctx.accounts.owner.key();
        d.mint = ctx.accounts.mint.key();
        d.operator = operator;
        d.max_amount = max_amount;
        d.used_amount = 0;
        d.expiry = expiry;
        d.period_seconds = period_seconds;
        d.window_start = now;
        d.window_amount = 0;
        d.recipients = recipients;
        d.bump = ctx.bumps.delegation;
        emit!(DelegationCreated { owner: d.owner, mint: d.mint, operator, max_amount, expiry });
        Ok(())
    }

    /// Operator-triggered transfer within an existing delegation. Moves `amount`
    /// from the owner's token account to `destination`, signed by the program's
    /// authority PDA (the SPL delegate) — no owner signature required.
    pub fn execute_delegated_transfer(ctx: Context<ExecuteDelegatedTransfer>, amount: u64) -> Result<()> {
        let d = &mut ctx.accounts.delegation;
        require_keys_eq!(ctx.accounts.operator.key(), d.operator, DelegationError::Unauthorized);

        let now = Clock::get()?.unix_timestamp;
        require!(d.expiry == 0 || now < d.expiry, DelegationError::Expired);

        // Cap check. With a period, enforce a rolling per-window cap (resetting
        // the window once it has elapsed); otherwise a single lifetime cap.
        if d.period_seconds > 0 {
            if now.saturating_sub(d.window_start) >= d.period_seconds {
                d.window_start = now;
                d.window_amount = 0;
            }
            require!(
                d.window_amount.checked_add(amount).unwrap() <= d.max_amount,
                DelegationError::CapExceeded
            );
        } else {
            require!(
                d.used_amount.checked_add(amount).unwrap() <= d.max_amount,
                DelegationError::CapExceeded
            );
        }

        // Defensive: source token account must belong to this delegation (mint + owner).
        {
            let data = ctx.accounts.source.try_borrow_data()?;
            require!(data.len() >= 64, DelegationError::InvalidTokenAccount);
            require!(&data[0..32] == d.mint.as_ref(), DelegationError::InvalidTokenAccount);
            require!(&data[32..64] == d.owner.as_ref(), DelegationError::InvalidTokenAccount);
        }

        // Recipient allowlist: if set, the destination's owner must be allowed.
        if !d.recipients.is_empty() {
            let data = ctx.accounts.destination.try_borrow_data()?;
            require!(data.len() >= 64, DelegationError::InvalidTokenAccount);
            let dest_owner = Pubkey::try_from(&data[32..64]).map_err(|_| DelegationError::InvalidTokenAccount)?;
            require!(d.recipients.contains(&dest_owner), DelegationError::RecipientNotAllowed);
        }

        // Hand-built SPL Token `transfer` (tag 3 + u64 amount), signed by the
        // authority PDA which the owner approved as the token account's delegate.
        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: ctx.accounts.token_program.key(),
            accounts: vec![
                anchor_lang::solana_program::instruction::AccountMeta::new(ctx.accounts.source.key(), false),
                anchor_lang::solana_program::instruction::AccountMeta::new(ctx.accounts.destination.key(), false),
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(ctx.accounts.authority.key(), true),
            ],
            data: {
                let mut v = Vec::with_capacity(9);
                v.push(3u8);
                v.extend_from_slice(&amount.to_le_bytes());
                v
            },
        };
        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.source.to_account_info(),
                ctx.accounts.destination.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
            &[&[b"authority", &[ctx.bumps.authority]]],
        )?;

        d.used_amount = d.used_amount.checked_add(amount).unwrap();
        if d.period_seconds > 0 {
            d.window_amount = d.window_amount.checked_add(amount).unwrap();
        }
        emit!(DelegatedTransfer { owner: d.owner, mint: d.mint, amount, used_amount: d.used_amount });
        Ok(())
    }

    /// Owner revokes their delegation, closing the PDA (rent back to owner). The
    /// owner should also send an SPL `revoke` for the token account.
    pub fn revoke_delegation(_ctx: Context<RevokeDelegation>) -> Result<()> {
        Ok(())
    }
}

const MAX_KEY_LEN: usize = 32;
const MAX_VALUE_LEN: usize = 200;

#[account]
pub struct DataFeed {
    pub authority: Pubkey,
    pub key: String,
    pub value: String,
    pub update_count: u64,
    pub updated_at: i64,
    pub bump: u8,
}

impl DataFeed {
    // discriminator + authority + key(len+max) + value(len+max) + count + ts + bump
    pub const SPACE: usize = 8 + 32 + (4 + MAX_KEY_LEN) + (4 + MAX_VALUE_LEN) + 8 + 8 + 1;
}

#[derive(Accounts)]
#[instruction(key: String)]
pub struct UpdateData<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = DataFeed::SPACE,
        seeds = [b"feed", authority.key().as_ref(), key.as_bytes()],
        bump
    )]
    pub feed: Account<'info, DataFeed>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Ping<'info> {
    pub signer: Signer<'info>,
}

#[account]
pub struct Proposal {
    pub authority: Pubkey,
    pub id: String,
    pub description: String,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub executed: bool,
    pub created_at: i64,
    pub bump: u8,
}

impl Proposal {
    pub const SPACE: usize =
        8 + 32 + (4 + MAX_KEY_LEN) + (4 + MAX_VALUE_LEN) + 8 + 8 + 1 + 8 + 1;
}

#[derive(Accounts)]
#[instruction(id: String)]
pub struct CreateProposal<'info> {
    #[account(
        init,
        payer = authority,
        space = Proposal::SPACE,
        seeds = [b"proposal", authority.key().as_ref(), id.as_bytes()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    pub voter: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(mut, has_one = authority)]
    pub proposal: Account<'info, Proposal>,
    pub authority: Signer<'info>,
}

#[event]
pub struct DataUpdated {
    pub authority: Pubkey,
    pub key: String,
    pub value: String,
    pub update_count: u64,
    pub updated_at: i64,
}

#[event]
pub struct Triggered {
    pub signer: Pubkey,
    pub label: String,
    pub timestamp: i64,
}

#[event]
pub struct ProposalCreated {
    pub authority: Pubkey,
    pub id: String,
}

#[event]
pub struct VoteCast {
    pub voter: Pubkey,
    pub approve: bool,
    pub yes_votes: u64,
    pub no_votes: u64,
}

#[event]
pub struct ProposalExecuted {
    pub authority: Pubkey,
    pub id: String,
    pub yes_votes: u64,
    pub no_votes: u64,
}

#[error_code]
pub enum FeedError {
    #[msg("Key exceeds 32 bytes")]
    KeyTooLong,
    #[msg("Value exceeds maximum length")]
    ValueTooLong,
}

#[error_code]
pub enum GovError {
    #[msg("Proposal already executed")]
    AlreadyExecuted,
    #[msg("Proposal has not passed (yes must exceed no)")]
    NotPassed,
}

// --- Delegated transfers -----------------------------------------------------

pub const MAX_RECIPIENTS: usize = 5;

#[account]
pub struct Delegation {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub operator: Pubkey,
    pub max_amount: u64,     // per-period cap if period_seconds > 0, else lifetime cap
    pub used_amount: u64,    // total moved over the delegation's life (display)
    pub expiry: i64,
    pub period_seconds: i64, // 0 = lifetime cap; >0 = rolling window length
    pub window_start: i64,   // unix start of the current window
    pub window_amount: u64,  // amount moved within the current window
    pub recipients: Vec<Pubkey>, // empty = any recipient allowed
    pub bump: u8,
}

impl Delegation {
    pub const SPACE: usize =
        8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + (4 + MAX_RECIPIENTS * 32) + 1;
}

#[derive(Accounts)]
pub struct CreateDelegation<'info> {
    #[account(
        init_if_needed,
        payer = owner,
        space = Delegation::SPACE,
        seeds = [b"delegation", owner.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub delegation: Account<'info, Delegation>,
    /// CHECK: only the mint's address is used (PDA seed + stored reference).
    pub mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteDelegatedTransfer<'info> {
    #[account(mut)]
    pub delegation: Account<'info, Delegation>,
    /// CHECK: owner's token account (source) — validated against the delegation
    /// in-handler and by the SPL Token program (must have approved our PDA).
    #[account(mut)]
    pub source: UncheckedAccount<'info>,
    /// CHECK: destination token account (validated by the Token program).
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    /// CHECK: program authority PDA — the approved token delegate.
    #[account(seeds = [b"authority"], bump)]
    pub authority: UncheckedAccount<'info>,
    pub operator: Signer<'info>,
    /// CHECK: SPL Token program.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RevokeDelegation<'info> {
    #[account(mut, close = owner, has_one = owner)]
    pub delegation: Account<'info, Delegation>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[event]
pub struct DelegationCreated {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub operator: Pubkey,
    pub max_amount: u64,
    pub expiry: i64,
}

#[event]
pub struct DelegatedTransfer {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub used_amount: u64,
}

#[error_code]
pub enum DelegationError {
    #[msg("Caller is not the authorized operator")]
    Unauthorized,
    #[msg("Delegation has expired")]
    Expired,
    #[msg("Transfer exceeds the delegated cap")]
    CapExceeded,
    #[msg("Source token account does not match the delegation")]
    InvalidTokenAccount,
    #[msg("Too many recipients (max 5)")]
    TooManyRecipients,
    #[msg("Recipient is not in the delegation's allowlist")]
    RecipientNotAllowed,
    #[msg("Period must be zero (lifetime) or a positive number of seconds")]
    InvalidPeriod,
}
