import { describe, it, expect } from 'vitest';
import { matchSub, type Subscription, type MatchData } from '../match';

const sub = (triggerType: string, config: Record<string, unknown> = {}): Subscription => ({
  workflowId: 'wf', triggerType, config,
});

describe('matchSub — program interaction (wallet filter)', () => {
  const data = (accounts: string[]): MatchData => ({ kind: 'program_success', accounts, logs: [] });

  it('fires for user_interacts_with_dapp when no wallet configured', () => {
    expect(matchSub(sub('user_interacts_with_dapp'), data(['X', 'Y']))).toBe(true);
  });

  it('fires only when the configured wallet is in the tx accounts', () => {
    expect(matchSub(sub('user_interacts_with_dapp', { wallet: 'ME' }), data(['ME', 'Y']))).toBe(true);
    expect(matchSub(sub('user_interacts_with_dapp', { wallet: 'ME' }), data(['X', 'Y']))).toBe(false);
  });

  it('applies the same wallet filter to specific_contract_interaction', () => {
    expect(matchSub(sub('specific_contract_interaction', { wallet: 'ME' }), data(['ME']))).toBe(true);
    expect(matchSub(sub('specific_contract_interaction', { wallet: 'ME' }), data(['Y']))).toBe(false);
  });

  it('fails closed when accounts are unavailable but a wallet is configured', () => {
    expect(matchSub(sub('user_interacts_with_dapp', { wallet: 'ME' }), { kind: 'program_success' })).toBe(false);
  });
});

describe('matchSub — governance vote (instruction filter)', () => {
  it('fires only when the logs show a vote instruction', () => {
    expect(matchSub(sub('governance_vote_triggered'), { kind: 'program_success', logs: ['Program log: Instruction: CastVote'] })).toBe(true);
    expect(matchSub(sub('governance_vote_triggered'), { kind: 'program_success', logs: ['Program log: Instruction: CreateProposal'] })).toBe(false);
  });
});

describe('matchSub — contract failure / event', () => {
  it('contract_execution_failed fires only on a failed program tx', () => {
    expect(matchSub(sub('contract_execution_failed'), { kind: 'program_failed' })).toBe(true);
    expect(matchSub(sub('contract_execution_failed'), { kind: 'program_success' })).toBe(false);
  });

  it('contract_event_emitted fires on any successful program activity', () => {
    expect(matchSub(sub('contract_event_emitted'), { kind: 'program_success', accounts: [], logs: [] })).toBe(true);
  });
});

describe('matchSub — fixed programs (collection / mint filters)', () => {
  it('nft_minted honors the collection filter', () => {
    const base = { kind: 'fixed', triggerType: 'nft_minted', logs: [] };
    expect(matchSub(sub('nft_minted', { collection: 'COLL' }), { ...base, accounts: ['COLL', 'mintX'] })).toBe(true);
    expect(matchSub(sub('nft_minted', { collection: 'COLL' }), { ...base, accounts: ['other'] })).toBe(false);
    expect(matchSub(sub('nft_minted'), { ...base, accounts: ['anything'] })).toBe(true); // no filter → fire
  });

  it('new_token_listing honors the mint filter', () => {
    const base = { kind: 'fixed', triggerType: 'new_token_listing', logs: [] };
    expect(matchSub(sub('new_token_listing', { mint: 'MINT' }), { ...base, accounts: ['MINT'] })).toBe(true);
    expect(matchSub(sub('new_token_listing', { mint: 'MINT' }), { ...base, accounts: ['x'] })).toBe(false);
  });

  it('cross_chain_token_transfer requires a transfer/post-message instruction', () => {
    const base = { kind: 'fixed', triggerType: 'cross_chain_token_transfer', accounts: [] };
    expect(matchSub(sub('cross_chain_token_transfer'), { ...base, logs: ['Program log: Instruction: TransferNative'] })).toBe(true);
    expect(matchSub(sub('cross_chain_token_transfer'), { ...base, logs: ['Program log: Instruction: Initialize'] })).toBe(false);
  });

  it('does not fire when the fixed event type differs from the subscription', () => {
    expect(matchSub(sub('nft_minted', { collection: 'C' }), { kind: 'fixed', triggerType: 'new_token_listing', accounts: ['C'] })).toBe(false);
  });
});

describe('matchSub — account direction (staking / vesting)', () => {
  it('staking_rewards_earned fires only when the balance increases', () => {
    expect(matchSub(sub('staking_rewards_earned'), { kind: 'account', lamportsDelta: 5000 })).toBe(true);
    expect(matchSub(sub('staking_rewards_earned'), { kind: 'account', lamportsDelta: -5000 })).toBe(false);
  });

  it('token_vesting_release fires only when value leaves the account', () => {
    expect(matchSub(sub('token_vesting_release'), { kind: 'account', lamportsDelta: -1000 })).toBe(true);
    expect(matchSub(sub('token_vesting_release'), { kind: 'account', lamportsDelta: 1000 })).toBe(false);
  });

  it('liquidity_pool_balance_changed fires on any change', () => {
    expect(matchSub(sub('liquidity_pool_balance_changed'), { kind: 'account', lamportsDelta: 1 })).toBe(true);
    expect(matchSub(sub('liquidity_pool_balance_changed'), { kind: 'account', lamportsDelta: -1 })).toBe(true);
  });
});

describe('matchSub — existing wallet/slot behavior preserved', () => {
  it('wallet_received_sol honors minAmount', () => {
    expect(matchSub(sub('wallet_received_sol', { minAmount: 0.5 }), { kind: 'wallet', triggerType: 'wallet_received_sol', amount: 1 })).toBe(true);
    expect(matchSub(sub('wallet_received_sol', { minAmount: 0.5 }), { kind: 'wallet', triggerType: 'wallet_received_sol', amount: 0.2 })).toBe(false);
  });

  it('new_block_mined honors everyNthSlot', () => {
    expect(matchSub(sub('new_block_mined', { everyNthSlot: 10 }), { kind: 'slot', slot: 100 })).toBe(true);
    expect(matchSub(sub('new_block_mined', { everyNthSlot: 10 }), { kind: 'slot', slot: 101 })).toBe(false);
  });
});
