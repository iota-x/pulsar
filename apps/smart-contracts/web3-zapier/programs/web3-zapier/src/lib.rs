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

#[error_code]
pub enum FeedError {
    #[msg("Key exceeds 32 bytes")]
    KeyTooLong,
    #[msg("Value exceeds maximum length")]
    ValueTooLong,
}
