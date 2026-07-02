import type { ActionHandler } from './types';
import { sendTokens } from './sendTokens';

/**
 * Reward a user with tokens — an SPL token transfer from the signer to the
 * recipient. Delegates to the send_tokens transfer logic.
 */
export const rewardUserTokens: ActionHandler = async (config, triggerData, ctx) => {
  if (!config.mint) throw new Error('reward_user_tokens: "mint" is required');
  const detail = await sendTokens(config, triggerData, ctx);
  return `Reward — ${detail}`;
};
