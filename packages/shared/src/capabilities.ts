/**
 * Capability metadata — the single source of truth for TWO independent axes
 * that the catalog alone doesn't capture:
 *
 *   1. Network requirement: does a capability behave meaningfully on devnet, or
 *      does it need mainnet's real liquidity / market data?
 *   2. Custody: whose funds & signature does an ACTION use — nobody's (off-chain),
 *      the platform operator key (custodial today), or the USER's own funds via
 *      the delegation program (non-custodial, the production target)?
 *
 * The builder UI reads this to warn users ("needs mainnet" / "uses your wallet"),
 * and the move to mainnet becomes a config flip rather than a code hunt.
 */

import type { ActionType, TriggerType } from './catalog';

// ---------------------------------------------------------------------------
// Axis 1 — Network
// ---------------------------------------------------------------------------

export type Cluster = 'devnet' | 'testnet' | 'mainnet-beta' | 'localnet';

/**
 * 'any'     → works on devnet and mainnet (pure on-chain ops or chain reads).
 * 'mainnet' → needs real liquidity / market data; on devnet it's degraded or
 *             non-functional (no routes, no prices, no real pools/bridges).
 */
export type NetworkReq = 'any' | 'mainnet';

/** Derive the active cluster from an RPC URL — the one place this is decided. */
export function clusterFromRpc(rpcUrl: string): Cluster {
  if (/devnet/i.test(rpcUrl)) return 'devnet';
  if (/testnet/i.test(rpcUrl)) return 'testnet';
  if (/localhost|127\.0\.0\.1/i.test(rpcUrl)) return 'localnet';
  return 'mainnet-beta';
}

// ---------------------------------------------------------------------------
// Axis 2 — Custody (actions only; triggers never move funds)
// ---------------------------------------------------------------------------

/**
 * 'none'      → no on-chain value moves (off-chain webhook / email / log).
 * 'operator'  → signed & paid by the platform operator key. CUSTODIAL today —
 *               either legitimately operator-owned (e.g. minting the platform's
 *               own token) or still pending migration to delegated user funds.
 * 'delegated' → can run on the USER's funds via the delegation program
 *               (create_delegation / execute_delegated_transfer). NON-CUSTODIAL:
 *               the operator signs only within the user's pre-approved limits and
 *               never holds their keys. This is the production model to default to.
 */
export type Custody = 'none' | 'operator' | 'delegated';

export interface ActionCapability {
  network: NetworkReq;
  custody: Custody;
}

export const ACTION_CAPABILITIES: Record<ActionType, ActionCapability> = {
  // Off-chain — no funds, runs anywhere.
  send_webhook: { network: 'any', custody: 'none' },
  send_discord_message: { network: 'any', custody: 'none' },
  send_email: { network: 'any', custody: 'none' },
  store_log: { network: 'any', custody: 'none' },
  send_notification: { network: 'any', custody: 'none' },
  record_transaction_db: { network: 'any', custody: 'none' },
  fetch_latest_transactions: { network: 'any', custody: 'none' },
  send_alert_and_rollback: { network: 'any', custody: 'none' },

  // Non-custodial capable — move the user's tokens via delegation.
  send_tokens: { network: 'any', custody: 'delegated' },
  reward_user_tokens: { network: 'any', custody: 'delegated' },
  initiate_custom_action: { network: 'any', custody: 'delegated' },
  execute_buy_sell_order: { network: 'mainnet', custody: 'delegated' }, // Jupiter liquidity is mainnet

  // Operator-signed today (custodial). Some are legitimately operator-owned
  // (mint authority, the platform's own program); others are migration targets.
  mint_tokens: { network: 'any', custody: 'operator' },
  burn_tokens: { network: 'any', custody: 'operator' },
  transfer_nft: { network: 'any', custody: 'operator' },
  stake_unstake_tokens: { network: 'any', custody: 'operator' },
  allocate_funds: { network: 'any', custody: 'operator' },
  deploy_contract: { network: 'any', custody: 'operator' },
  update_oracle_data: { network: 'any', custody: 'operator' },
  update_contract_state: { network: 'any', custody: 'operator' },
  trigger_smart_contract: { network: 'any', custody: 'operator' },
  execute_governance_action: { network: 'any', custody: 'operator' },
  create_liquidity_pool: { network: 'mainnet', custody: 'operator' }, // Raydium real pools are mainnet
  trigger_cross_chain_tx: { network: 'mainnet', custody: 'operator' }, // Wormhole real bridging is mainnet
};

// ---------------------------------------------------------------------------
// Triggers — only the network axis applies (detection just reads the chain).
// ---------------------------------------------------------------------------

export const TRIGGER_NETWORK: Record<TriggerType, NetworkReq> = {
  wallet_received_sol: 'any',
  wallet_received_token: 'any',
  wallet_received_nft: 'any',
  transaction_confirmed: 'any',
  nft_minted: 'any',
  wallet_balance_below_threshold: 'any',
  contract_event_emitted: 'any',
  nft_transferred: 'any',
  new_block_mined: 'any',
  contract_execution_failed: 'any',
  wallet_funded_by_address: 'any',
  governance_vote_triggered: 'any',
  user_interacts_with_dapp: 'any',
  token_swap_executed: 'any', // detection works on devnet; real swaps are mainnet
  liquidity_pool_balance_changed: 'any',
  specific_contract_interaction: 'any',
  scheduled_time: 'any',
  airdrop_detected: 'any',
  token_vesting_release: 'any',
  staking_rewards_earned: 'any',
  // Need real market data / liquidity / a live bridge to mean anything:
  token_price_threshold: 'mainnet', // Jupiter price API = mainnet mints
  new_token_listing: 'mainnet', // real DEX listings are mainnet
  cross_chain_token_transfer: 'mainnet', // real Wormhole transfers are mainnet
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Does this trigger or action need mainnet to behave meaningfully? */
export function requiresMainnet(type: ActionType | TriggerType): boolean {
  const req =
    type in ACTION_CAPABILITIES
      ? ACTION_CAPABILITIES[type as ActionType].network
      : TRIGGER_NETWORK[type as TriggerType];
  return req === 'mainnet';
}

/** Custody model for an action ('none' for triggers — they never move funds). */
export function custodyOf(type: ActionType): Custody {
  return ACTION_CAPABILITIES[type]?.custody ?? 'none';
}

/** Is a capability runnable on the given cluster (mainnet-only ones aren't on devnet)? */
export function isRunnableOn(type: ActionType | TriggerType, cluster: Cluster): boolean {
  if (!requiresMainnet(type)) return true;
  return cluster === 'mainnet-beta';
}
