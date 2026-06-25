import type { TriggerConfig } from '@web3-zapier/shared';

/**
 * Trigger detection is split in two: the watcher emits a low-level event tagged
 * with a `kind` (which subscription family produced it), and the matcher here
 * decides whether that event satisfies a configured subscription — applying the
 * per-type config filters (wallet / mint / collection / instruction). Keeping it
 * pure (no I/O) makes the whole firing decision unit-testable.
 */

export type Subscription = { workflowId: string; triggerType: string; config: TriggerConfig };

/** The enriched event shape the matcher reads (superset of what the watcher emits). */
export interface MatchData {
  kind: string;
  triggerType?: string;
  // wallet-family fields
  amount?: number;
  balanceSol?: number;
  fromAddress?: string;
  mint?: string;
  // program/fixed-family enrichment
  accounts?: string[];
  logs?: string[];
  // account-family enrichment — change in the account's value (token amount for
  // SPL token accounts, else lamports); sign indicates rewards (+) vs release (−).
  valueDelta?: number;
  // slot-family
  slot?: number;
}

// Trigger type → which subscription family it belongs to.
export const WALLET_TYPES = new Set([
  'wallet_received_sol', 'wallet_received_token', 'wallet_received_nft', 'airdrop_detected',
  'transaction_confirmed', 'wallet_balance_below_threshold', 'wallet_funded_by_address',
  'token_swap_executed',
]);
export const PROGRAM_TYPES = new Set([
  'contract_event_emitted', 'contract_execution_failed', 'specific_contract_interaction',
  'user_interacts_with_dapp', 'governance_vote_triggered',
]);
export const PROGRAM_SUCCESS_TYPES = new Set([
  'contract_event_emitted', 'specific_contract_interaction', 'user_interacts_with_dapp', 'governance_vote_triggered',
]);
export const ACCOUNT_TYPES = new Set(['liquidity_pool_balance_changed', 'staking_rewards_earned', 'token_vesting_release']);

/** Instruction-name patterns that identify the semantic event in a program's logs. */
const INSTRUCTION_FILTER: Record<string, RegExp> = {
  // SPL Governance casts/relinquishes a vote via these instructions.
  governance_vote_triggered: /Instruction:\s*(Cast|Relinquish)?Vote/i,
  // Wormhole token bridge transfer instructions / core-bridge message post.
  cross_chain_token_transfer: /Instruction:\s*(Transfer(Native|Wrapped)?|PostMessage)|Sequence:/i,
};

const involves = (data: MatchData, address?: unknown): boolean =>
  typeof address === 'string' && Array.isArray(data.accounts) && data.accounts.includes(address);

const logsMatch = (data: MatchData, re: RegExp): boolean =>
  Array.isArray(data.logs) && data.logs.some((l) => re.test(l));

/**
 * Does a detected event satisfy a subscription? Pure function of (sub, event).
 * Filters narrow a family event down to the specific configured trigger; when a
 * filter is configured but the data needed to evaluate it is absent, we DON'T
 * fire (fail closed) so a precise trigger never silently behaves like a firehose.
 */
export function matchSub(sub: Subscription, data: MatchData): boolean {
  switch (data.kind) {
    case 'fixed': // nft_minted / new_token_listing / cross_chain_token_transfer
      if (sub.triggerType !== data.triggerType) return false;
      if (sub.triggerType === 'nft_minted' && sub.config.collection) return involves(data, sub.config.collection);
      if (sub.triggerType === 'new_token_listing' && sub.config.mint) return involves(data, sub.config.mint);
      if (sub.triggerType === 'cross_chain_token_transfer') return logsMatch(data, INSTRUCTION_FILTER.cross_chain_token_transfer);
      return true;

    case 'mint': // nft_transferred for a specific mint (target already scopes the mint)
      return sub.triggerType === 'nft_transferred';

    case 'program_success':
      if (!PROGRAM_SUCCESS_TYPES.has(sub.triggerType)) return false;
      // A governance vote is a specific instruction, not any successful tx.
      if (sub.triggerType === 'governance_vote_triggered') return logsMatch(data, INSTRUCTION_FILTER.governance_vote_triggered);
      // Optional wallet filter: only fire for the configured user's interaction.
      if (sub.triggerType === 'user_interacts_with_dapp' || sub.triggerType === 'specific_contract_interaction') {
        return !sub.config.wallet || involves(data, sub.config.wallet);
      }
      return true; // contract_event_emitted: any successful program activity

    case 'program_failed':
      return sub.triggerType === 'contract_execution_failed';

    case 'account':
      if (!ACCOUNT_TYPES.has(sub.triggerType)) return false;
      // Rewards credited → value rises; a vesting release → value leaves the account.
      if (sub.triggerType === 'staking_rewards_earned') return typeof data.valueDelta === 'number' && data.valueDelta > 0;
      if (sub.triggerType === 'token_vesting_release') return typeof data.valueDelta === 'number' && data.valueDelta < 0;
      return true; // liquidity_pool_balance_changed: any balance change

    case 'slot': {
      if (sub.triggerType !== 'new_block_mined') return false;
      const every = Number(sub.config.everyNthSlot) || 1;
      return typeof data.slot === 'number' && data.slot % every === 0;
    }

    case 'wallet':
    default:
      if (sub.triggerType !== data.triggerType) return false;
      if (data.triggerType === 'wallet_balance_below_threshold') {
        const th = sub.config.threshold;
        return typeof th === 'number' && typeof data.balanceSol === 'number' && data.balanceSol < th;
      }
      if (data.triggerType === 'wallet_funded_by_address') {
        return !sub.config.fromAddress || sub.config.fromAddress === data.fromAddress;
      }
      if (
        sub.config.mint &&
        (data.triggerType === 'wallet_received_token' || data.triggerType === 'wallet_received_nft' || data.triggerType === 'airdrop_detected')
      ) {
        if (data.mint !== sub.config.mint) return false;
      }
      if (sub.config.minAmount != null && typeof data.amount === 'number') return data.amount >= sub.config.minAmount;
      return true;
  }
}
