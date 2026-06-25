import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../actions/template';
import type { TriggerData } from '@web3-zapier/shared';

describe('renderTemplate', () => {
  const data: TriggerData = {
    triggerType: 'wallet_received_sol',
    wallet: 'Acz4nt4FEXApUNegKgAaQCz5qBNoToZ5dyb38VRMVeQC',
    amount: 1,
    balanceSol: 3.4,
  } as TriggerData;

  it('substitutes single-brace placeholders from trigger data', () => {
    expect(renderTemplate('🪂 {wallet} received {amount} SOL — balance {balanceSol}', data)).toBe(
      '🪂 Acz4nt4FEXApUNegKgAaQCz5qBNoToZ5dyb38VRMVeQC received 1 SOL — balance 3.4',
    );
  });

  it('leaves unknown placeholders untouched', () => {
    expect(renderTemplate('sig: {signature}', data)).toBe('sig: {signature}');
  });

  it('renders the default Discord template', () => {
    expect(renderTemplate('⚡ {triggerType} on {wallet}', data)).toBe(
      '⚡ wallet_received_sol on Acz4nt4FEXApUNegKgAaQCz5qBNoToZ5dyb38VRMVeQC',
    );
  });
});
