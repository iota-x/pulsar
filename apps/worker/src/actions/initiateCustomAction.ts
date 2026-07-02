import type { ActionHandler } from './types';
import { executeBuySellOrder } from './executeBuySellOrder';
import { stakeUnstake } from './stakeUnstake';
import { sendTokens } from './sendTokens';
import { callPing } from '../anchorProgram';

/**
 * Initiate a custom on-chain action. Routes by `instruction`:
 *   swap            → Jupiter swap (execute_buy_sell_order)
 *   stake / unstake → native staking (stake_unstake_tokens)
 *   send / transfer → token/SOL transfer (send_tokens)
 *   anything else   → invoke our program's ping with the label
 */
export const initiateCustomAction: ActionHandler = async (config, triggerData, ctx) => {
  const instruction = ((config.instruction as string) || '').toLowerCase();

  switch (instruction) {
    case 'swap':
      return executeBuySellOrder(config, triggerData, ctx);
    case 'stake':
    case 'unstake':
      return stakeUnstake({ ...config, mode: instruction }, triggerData, ctx);
    case 'send':
    case 'transfer':
      return sendTokens(config, triggerData, ctx);
    default: {
      const url = await callPing(instruction || 'custom_action');
      return `Custom action "${instruction || 'custom'}" invoked on-chain — ${url}`;
    }
  }
};
