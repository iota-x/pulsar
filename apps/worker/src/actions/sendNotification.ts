import type { ActionHandler } from './types';
import { renderTemplate } from './template';

/**
 * Send a notification. For `channel: webhook` it POSTs to the given URL;
 * otherwise it records an in-app notification (surfaced via the execution log).
 * The message supports `{placeholder}` tokens from the trigger data.
 */
export const sendNotification: ActionHandler = async (config, triggerData) => {
  const template = (config.message as string) || `Workflow triggered: {triggerType}`;
  const message = renderTemplate(template, triggerData);

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
