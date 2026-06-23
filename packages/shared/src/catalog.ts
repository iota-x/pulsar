/**
 * The Web3 Zapier catalog — the single source of truth for every trigger and
 * action the platform offers. The API (validation), the trigger service
 * (detection), the worker (execution) and the frontend (builder UI) all derive
 * from these tables, so adding a new automation primitive happens in one place.
 *
 * `implementation` mirrors how each primitive is realized:
 *   - 'api'            → off-chain via RPC / HTTP (fully runnable today)
 *   - 'smart_contract' → requires an on-chain program + signer (Anchor program)
 *   - 'hybrid'         → can run either way depending on config
 */

export type Implementation = 'api' | 'smart_contract' | 'hybrid';

export interface CatalogField {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'select';
  options?: string[];
  required?: boolean;
  help?: string;
}

export interface CatalogEntry<T extends string> {
  type: T;
  label: string;
  description: string;
  implementation: Implementation;
  fields: CatalogField[];
}

// Reusable field fragments ---------------------------------------------------
const wallet: CatalogField = {
  key: 'wallet',
  label: 'Wallet address',
  placeholder: 'Base58 address to watch',
  required: true,
};
const programId: CatalogField = {
  key: 'programId',
  label: 'Program ID',
  placeholder: 'On-chain program address',
  required: true,
};
const mint: CatalogField = { key: 'mint', label: 'Token mint', placeholder: 'SPL token mint address' };

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export type TriggerType =
  | 'wallet_received_sol'
  | 'wallet_received_token'
  | 'wallet_received_nft'
  | 'transaction_confirmed'
  | 'nft_minted'
  | 'wallet_balance_below_threshold'
  | 'contract_event_emitted'
  | 'nft_transferred'
  | 'new_block_mined'
  | 'token_price_threshold'
  | 'contract_execution_failed'
  | 'wallet_funded_by_address'
  | 'governance_vote_triggered'
  | 'user_interacts_with_dapp'
  | 'token_swap_executed'
  | 'liquidity_pool_balance_changed'
  | 'new_token_listing'
  | 'specific_contract_interaction'
  | 'scheduled_time'
  | 'airdrop_detected'
  | 'token_vesting_release'
  | 'cross_chain_token_transfer'
  | 'staking_rewards_earned';

export const TRIGGER_CATALOG: CatalogEntry<TriggerType>[] = [
  {
    type: 'wallet_received_sol',
    label: 'Wallet receives SOL',
    description: 'Fires when a watched wallet receives native SOL.',
    implementation: 'api',
    fields: [wallet, { key: 'minAmount', label: 'Min SOL', type: 'number', placeholder: 'e.g. 0.1', help: 'Only fire above this amount' }],
  },
  {
    type: 'wallet_received_token',
    label: 'Wallet receives token',
    description: 'Detects when a specific SPL token is received in a wallet.',
    implementation: 'smart_contract',
    fields: [wallet, mint],
  },
  {
    type: 'wallet_received_nft',
    label: 'Wallet receives NFT',
    description: 'Monitors a wallet for the transfer-in of an NFT.',
    implementation: 'smart_contract',
    fields: [wallet, { key: 'collection', label: 'Collection', placeholder: 'Collection address (optional)' }],
  },
  {
    type: 'transaction_confirmed',
    label: 'Transaction confirmed',
    description: 'Fires when a transaction involving the wallet is confirmed.',
    implementation: 'api',
    fields: [wallet],
  },
  {
    type: 'nft_minted',
    label: 'NFT minted',
    description: 'Detects when a new NFT is minted in a collection.',
    implementation: 'smart_contract',
    fields: [{ key: 'collection', label: 'Collection', placeholder: 'Collection address', required: true }],
  },
  {
    type: 'wallet_balance_below_threshold',
    label: 'Wallet balance drops below threshold',
    description: "Triggers when a wallet's SOL balance falls below a set amount.",
    implementation: 'api',
    fields: [wallet, { key: 'threshold', label: 'Threshold (SOL)', type: 'number', placeholder: 'e.g. 1.0', required: true }],
  },
  {
    type: 'contract_event_emitted',
    label: 'Smart contract emits an event',
    description: 'Listens for a specific event emitted by a program.',
    implementation: 'smart_contract',
    fields: [programId, { key: 'eventName', label: 'Event name', placeholder: 'e.g. TradeExecuted' }],
  },
  {
    type: 'nft_transferred',
    label: 'NFT is transferred',
    description: 'Monitors transfers of a specific NFT.',
    implementation: 'smart_contract',
    fields: [{ ...mint, label: 'NFT mint', required: true }, { key: 'wallet', label: 'Wallet (optional)', placeholder: 'Filter by wallet' }],
  },
  {
    type: 'new_block_mined',
    label: 'New block is mined',
    description: 'Triggers when a new block / slot is produced on Solana.',
    implementation: 'api',
    fields: [{ key: 'everyNthSlot', label: 'Every N slots', type: 'number', placeholder: 'e.g. 1000', help: 'Throttle how often this fires' }],
  },
  {
    type: 'token_price_threshold',
    label: 'Token price reaches a level',
    description: 'Watches a market price and fires when it crosses a threshold.',
    implementation: 'api',
    fields: [
      { ...mint, label: 'Token mint', required: true },
      { key: 'targetPrice', label: 'Target price (USD)', type: 'number', required: true },
      { key: 'direction', label: 'Direction', type: 'select', options: ['above', 'below'] },
    ],
  },
  {
    type: 'contract_execution_failed',
    label: 'Smart contract execution fails',
    description: 'Detects when a program fails to execute properly.',
    implementation: 'smart_contract',
    fields: [programId],
  },
  {
    type: 'wallet_funded_by_address',
    label: 'Wallet funded by a specific address',
    description: 'Monitors a wallet for incoming transfers from a given address.',
    implementation: 'api',
    fields: [wallet, { key: 'fromAddress', label: 'From address', placeholder: 'Sender address', required: true }],
  },
  {
    type: 'governance_vote_triggered',
    label: 'Governance vote is triggered',
    description: 'Activates when a governance vote is initiated.',
    implementation: 'smart_contract',
    fields: [{ ...programId, label: 'Realm / governance program' }],
  },
  {
    type: 'user_interacts_with_dapp',
    label: 'User interacts with a dApp',
    description: 'Tracks interactions of a user with a decentralized application.',
    implementation: 'smart_contract',
    fields: [programId, { key: 'wallet', label: 'User wallet (optional)', placeholder: 'Filter by user' }],
  },
  {
    type: 'token_swap_executed',
    label: 'Token swap executed',
    description: 'Detects a successful swap on a decentralized exchange.',
    implementation: 'smart_contract',
    fields: [wallet, mint],
  },
  {
    type: 'liquidity_pool_balance_changed',
    label: 'Liquidity pool balance changes',
    description: 'Monitors changes in the balance of a liquidity pool.',
    implementation: 'api',
    fields: [{ key: 'poolAddress', label: 'Pool address', required: true }],
  },
  {
    type: 'new_token_listing',
    label: 'New token listing on exchange',
    description: 'Fires when a new token is listed on a DEX.',
    implementation: 'api',
    fields: [{ key: 'exchange', label: 'Exchange', placeholder: 'e.g. Raydium' }, mint],
  },
  {
    type: 'specific_contract_interaction',
    label: 'Specific contract interaction detected',
    description: 'Monitors a contract for interactions from specific wallets.',
    implementation: 'smart_contract',
    fields: [programId, { key: 'wallet', label: 'Wallet (optional)', placeholder: 'Filter by wallet' }],
  },
  {
    type: 'scheduled_time',
    label: 'Scheduled time trigger',
    description: 'Executes the workflow on a fixed interval.',
    implementation: 'api',
    fields: [{ key: 'intervalSeconds', label: 'Interval (seconds)', type: 'number', placeholder: 'e.g. 3600', required: true }],
  },
  {
    type: 'airdrop_detected',
    label: 'Airdrop detection',
    description: 'Monitors a wallet for tokens received via airdrop.',
    implementation: 'api',
    fields: [wallet],
  },
  {
    type: 'token_vesting_release',
    label: 'Token vesting release',
    description: 'Fires when a vesting period ends and tokens are released.',
    implementation: 'smart_contract',
    fields: [{ key: 'vestingAccount', label: 'Vesting account', required: true }],
  },
  {
    type: 'cross_chain_token_transfer',
    label: 'Cross-chain token transfer',
    description: 'Detects a token transfer across different blockchain networks.',
    implementation: 'smart_contract',
    fields: [wallet, { key: 'chain', label: 'Source/target chain', placeholder: 'e.g. Ethereum' }],
  },
  {
    type: 'staking_rewards_earned',
    label: 'Staking rewards earned',
    description: 'Monitors when staking rewards are earned in a wallet.',
    implementation: 'smart_contract',
    fields: [wallet, { key: 'stakeAccount', label: 'Stake account (optional)' }],
  },
];

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ActionType =
  | 'send_webhook'
  | 'send_discord_message'
  | 'send_email'
  | 'store_log'
  | 'send_notification'
  | 'initiate_custom_action'
  | 'trigger_smart_contract'
  | 'record_transaction_db'
  | 'fetch_latest_transactions'
  | 'execute_buy_sell_order'
  | 'send_alert_and_rollback'
  | 'reward_user_tokens'
  | 'execute_governance_action'
  | 'update_contract_state'
  | 'mint_tokens'
  | 'burn_tokens'
  | 'transfer_nft'
  | 'deploy_contract'
  | 'stake_unstake_tokens'
  | 'allocate_funds'
  | 'create_liquidity_pool'
  | 'update_oracle_data'
  | 'trigger_cross_chain_tx'
  | 'send_tokens';

const toAddress: CatalogField = { key: 'to', label: 'Recipient', placeholder: 'Destination wallet', required: true };
const amount: CatalogField = { key: 'amount', label: 'Amount', type: 'number', required: true };

export const ACTION_CATALOG: CatalogEntry<ActionType>[] = [
  {
    type: 'send_webhook',
    label: 'Send webhook',
    description: 'POSTs the trigger data to an arbitrary URL.',
    implementation: 'api',
    fields: [
      { key: 'url', label: 'Webhook URL', placeholder: 'https://…', required: true },
      { key: 'method', label: 'Method', type: 'select', options: ['POST', 'GET', 'PUT', 'PATCH'] },
    ],
  },
  {
    type: 'send_discord_message',
    label: 'Send Discord message',
    description: 'Posts a message to a Discord channel via a webhook.',
    implementation: 'api',
    fields: [
      { key: 'webhookUrl', label: 'Discord webhook URL', placeholder: 'https://discord.com/api/webhooks/…', required: true },
      { key: 'content', label: 'Message', placeholder: '⚡ {triggerType} on {wallet}', help: 'Use {placeholders} from trigger data' },
    ],
  },
  {
    type: 'send_email',
    label: 'Send email',
    description: 'Sends an email notification.',
    implementation: 'api',
    fields: [
      { key: 'to', label: 'To', placeholder: 'recipient@example.com', required: true },
      { key: 'subject', label: 'Subject' },
      { key: 'body', label: 'Body' },
    ],
  },
  {
    type: 'store_log',
    label: 'Store log',
    description: 'Records that the trigger fired.',
    implementation: 'api',
    fields: [],
  },
  {
    type: 'send_notification',
    label: 'Send a notification',
    description: 'Sends a notification to a user or system when a condition is met.',
    implementation: 'api',
    fields: [
      { key: 'channel', label: 'Channel', type: 'select', options: ['in_app', 'webhook'] },
      { key: 'message', label: 'Message', placeholder: 'Notification text' },
      { key: 'url', label: 'Webhook URL (if channel = webhook)', placeholder: 'https://…' },
    ],
  },
  {
    type: 'initiate_custom_action',
    label: 'Initiate a custom action (swap / stake)',
    description: 'Executes a custom on-chain action like swapping or staking tokens.',
    implementation: 'smart_contract',
    fields: [programId, { key: 'instruction', label: 'Instruction', placeholder: 'e.g. swap' }, { key: 'params', label: 'Params (JSON)' }],
  },
  {
    type: 'trigger_smart_contract',
    label: 'Trigger another smart contract',
    description: 'Initiates the execution of another smart contract.',
    implementation: 'smart_contract',
    fields: [programId, { key: 'instruction', label: 'Instruction' }],
  },
  {
    type: 'record_transaction_db',
    label: 'Record transaction in external database',
    description: 'Logs transaction details to an external database endpoint.',
    implementation: 'api',
    fields: [{ key: 'url', label: 'Database/API endpoint', placeholder: 'https://…', required: true }],
  },
  {
    type: 'fetch_latest_transactions',
    label: 'Fetch latest transactions',
    description: 'Retrieves the most recent transactions for an address from the chain.',
    implementation: 'api',
    fields: [wallet, { key: 'limit', label: 'Limit', type: 'number', placeholder: '10' }],
  },
  {
    type: 'execute_buy_sell_order',
    label: 'Execute a buy/sell order',
    description: 'Swaps via Jupiter — buy spends SOL for the token, sell swaps the token back to SOL.',
    implementation: 'hybrid',
    fields: [
      { ...mint, label: 'Token mint', required: true },
      { key: 'side', label: 'Side', type: 'select', options: ['buy', 'sell'] },
      { key: 'amount', label: 'Amount (SOL to buy / tokens to sell)', type: 'number', required: true },
      { key: 'slippageBps', label: 'Slippage (bps)', type: 'number', placeholder: '50' },
    ],
  },
  {
    type: 'send_alert_and_rollback',
    label: 'Send alert and rollback',
    description: 'Sends an alert and rolls back a transaction on failure.',
    implementation: 'smart_contract',
    fields: [{ key: 'webhookUrl', label: 'Alert webhook URL', placeholder: 'https://…' }],
  },
  {
    type: 'reward_user_tokens',
    label: 'Reward user with tokens',
    description: 'Sends a specified amount of tokens to a user as a reward.',
    implementation: 'smart_contract',
    fields: [toAddress, { ...mint, required: true }, amount],
  },
  {
    type: 'execute_governance_action',
    label: 'Execute governance proposal action',
    description: 'Carries out the actions defined in a governance proposal.',
    implementation: 'smart_contract',
    fields: [programId, { key: 'proposal', label: 'Proposal ID' }],
  },
  {
    type: 'update_contract_state',
    label: 'Update smart contract state',
    description: 'Updates the state or data stored in a smart contract.',
    implementation: 'smart_contract',
    fields: [programId, { key: 'field', label: 'Field' }, { key: 'value', label: 'Value' }],
  },
  {
    type: 'mint_tokens',
    label: 'Mint new tokens',
    description: 'Mints new tokens based on specific conditions or triggers.',
    implementation: 'smart_contract',
    fields: [{ ...mint, required: true }, toAddress, amount],
  },
  {
    type: 'burn_tokens',
    label: 'Burn tokens',
    description: 'Burns a specified amount of tokens when triggered.',
    implementation: 'smart_contract',
    fields: [{ ...mint, required: true }, amount],
  },
  {
    type: 'transfer_nft',
    label: 'Transfer NFTs',
    description: 'Automatically transfers an NFT from one wallet to another.',
    implementation: 'smart_contract',
    fields: [{ ...mint, label: 'NFT mint', required: true }, toAddress],
  },
  {
    type: 'deploy_contract',
    label: 'Deploy a new smart contract',
    description: 'Deploys a new smart contract as a result of a trigger.',
    implementation: 'smart_contract',
    fields: [{ key: 'programPath', label: 'Program artifact', placeholder: 'Path / URL to .so' }],
  },
  {
    type: 'stake_unstake_tokens',
    label: 'Stake / unstake SOL',
    description: 'Stakes native SOL to a validator, or deactivates a stake account to unstake.',
    implementation: 'smart_contract',
    fields: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['stake', 'unstake'] },
      { key: 'amount', label: 'Amount (SOL, to stake)', type: 'number', placeholder: 'e.g. 0.05' },
      { key: 'validator', label: 'Validator vote account (stake; optional)', placeholder: 'Auto-picks an active validator if blank' },
      { key: 'stakeAccount', label: 'Stake account (to unstake)', placeholder: 'Address returned when you staked' },
    ],
  },
  {
    type: 'allocate_funds',
    label: 'Allocate funds',
    description: 'Allocates or redistributes funds across multiple wallets or contracts.',
    implementation: 'smart_contract',
    fields: [{ key: 'targets', label: 'Targets (JSON)', placeholder: '[{"to":"…","amount":1}]' }],
  },
  {
    type: 'create_liquidity_pool',
    label: 'Create liquidity pool',
    description: 'Creates a Raydium CPMM pool from two tokens (tokenB defaults to wrapped SOL).',
    implementation: 'smart_contract',
    fields: [
      { key: 'tokenA', label: 'Token A mint', required: true },
      { key: 'amountA', label: 'Amount A', type: 'number', required: true },
      { key: 'tokenB', label: 'Token B mint (defaults to wSOL)', placeholder: 'So111…112' },
      { key: 'amountB', label: 'Amount B', type: 'number', required: true },
    ],
  },
  {
    type: 'update_oracle_data',
    label: 'Update oracle data',
    description: 'Pushes new data to an on-chain oracle when triggered.',
    implementation: 'smart_contract',
    fields: [{ key: 'oracle', label: 'Oracle account', required: true }, { key: 'value', label: 'Value', required: true }],
  },
  {
    type: 'trigger_cross_chain_tx',
    label: 'Trigger cross-chain transaction',
    description: 'Initiates a cross-chain transaction between blockchain networks.',
    implementation: 'smart_contract',
    fields: [{ key: 'targetChain', label: 'Target chain', required: true }, toAddress, amount],
  },
  {
    type: 'send_tokens',
    label: 'Send tokens',
    description: 'Sends a specific amount of tokens to a designated wallet.',
    implementation: 'hybrid',
    fields: [toAddress, mint, amount],
  },
];

// ---------------------------------------------------------------------------
// Derived lookups
// ---------------------------------------------------------------------------

export const TRIGGER_TYPES = TRIGGER_CATALOG.map((t) => t.type) as [TriggerType, ...TriggerType[]];
export const ACTION_TYPES = ACTION_CATALOG.map((a) => a.type) as [ActionType, ...ActionType[]];

export const TRIGGER_BY_TYPE: Record<TriggerType, CatalogEntry<TriggerType>> = Object.fromEntries(
  TRIGGER_CATALOG.map((t) => [t.type, t]),
) as Record<TriggerType, CatalogEntry<TriggerType>>;

export const ACTION_BY_TYPE: Record<ActionType, CatalogEntry<ActionType>> = Object.fromEntries(
  ACTION_CATALOG.map((a) => [a.type, a]),
) as Record<ActionType, CatalogEntry<ActionType>>;

export const TRIGGER_LABELS = Object.fromEntries(
  TRIGGER_CATALOG.map((t) => [t.type, t.label]),
) as Record<TriggerType, string>;

export const ACTION_LABELS = Object.fromEntries(
  ACTION_CATALOG.map((a) => [a.type, a.label]),
) as Record<ActionType, string>;

export const isTriggerType = (v: unknown): v is TriggerType =>
  typeof v === 'string' && v in TRIGGER_BY_TYPE;

export const isActionType = (v: unknown): v is ActionType =>
  typeof v === 'string' && v in ACTION_BY_TYPE;
