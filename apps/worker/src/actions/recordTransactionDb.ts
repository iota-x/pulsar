import type { ActionHandler } from './types';

/** Record the trigger/transaction details to an external database endpoint. */
export const recordTransactionDb: ActionHandler = async (config, triggerData) => {
  if (!config.url) throw new Error('record_transaction_db: "url" is required');

  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordedAt: new Date().toISOString(), triggerData }),
  });
  if (!res.ok) throw new Error(`Database endpoint responded ${res.status}`);
  return `Transaction recorded to external DB (${res.status})`;
};
