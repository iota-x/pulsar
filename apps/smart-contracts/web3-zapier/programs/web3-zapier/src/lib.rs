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
