import type { ActionHandler } from './types';

/**
 * Send an alert and (conceptually) roll back. On Solana, a transaction is
 * atomic — any failed instruction reverts the whole transaction automatically —
 * so this action's job is to fire the alert. Posts to `webhookUrl` if set.
 */
export const sendAlertAndRollback: ActionHandler = async (config, triggerData) => {
  const note = 'Solana transactions are atomic — a failed instruction rolls back the whole tx automatically.';

  if (config.webhookUrl) {
    const res = await fetch(config.webhookUrl as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert: 'web3-zapier workflow alert', triggerData }),
    });
    if (!res.ok) throw new Error(`Alert webhook responded ${res.status}`);
    return `Alert sent (${res.status}). ${note}`;
  }
  console.log('[send_alert_and_rollback] alert:', JSON.stringify(triggerData));
  return `Alert logged. ${note}`;
};
