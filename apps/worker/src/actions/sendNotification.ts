import type { ActionHandler } from './types';

/**
 * Send a notification. For `channel: webhook` it POSTs to the given URL;
 * otherwise it records an in-app notification (surfaced via the execution log).
 */
export const sendNotification: ActionHandler = async (config, triggerData) => {
  const message =
    (config.message as string) || `Workflow triggered: ${triggerData.triggerType}`;

  if (config.channel === 'webhook') {
    if (!config.url) throw new Error('send_notification: "url" is required for webhook channel');
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, triggerData }),
    });
    if (!res.ok) throw new Error(`Notification webhook responded ${res.status}`);
    return `Notification delivered via webhook (${res.status})`;
  }

  console.log(`[send_notification] ${message}`);
  return `In-app notification: ${message}`;
};
