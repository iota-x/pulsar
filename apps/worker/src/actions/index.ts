import type { ActionType } from '@web3-zapier/shared';
import type { ActionHandler } from './types';
import { sendWebhook } from './sendWebhook';
import { sendDiscordMessage } from './sendDiscordMessage';
import { sendEmail } from './sendEmail';
import { storeLog } from './storeLog';
import { sendNotification } from './sendNotification';
import { recordTransactionDb } from './recordTransactionDb';
import { fetchLatestTransactions } from './fetchLatestTransactions';
import { sendTokens } from './sendTokens';
import { mintTokens } from './mintTokens';
import { burnTokens } from './burnTokens';
import { transferNft } from './transferNft';

/**
 * Handlers for action types that run fully off-chain today. Action types absent
 * from this registry are "simulated" by the executor — they're selectable and
 * persisted, but executing them for real requires an on-chain signer (the
 * Anchor program in apps/smart-contracts). This keeps execution logs honest.
 */
export const actionHandlers: Partial<Record<ActionType, ActionHandler>> = {
  send_webhook: sendWebhook,
  send_discord_message: sendDiscordMessage,
  send_email: sendEmail,
  store_log: storeLog,
  send_notification: sendNotification,
  record_transaction_db: recordTransactionDb,
  fetch_latest_transactions: fetchLatestTransactions,
  send_tokens: sendTokens,
  mint_tokens: mintTokens,
  burn_tokens: burnTokens,
  transfer_nft: transferNft,
};
