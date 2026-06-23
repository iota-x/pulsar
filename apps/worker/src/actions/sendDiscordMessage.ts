import type { ActionHandler } from './types';
import { renderTemplate } from './template';

/**
 * Post a message to a Discord channel via an incoming webhook URL.
 * Supports a few `{placeholders}` resolved from the trigger data.
 */
export const sendDiscordMessage: ActionHandler = async (config, triggerData) => {
  if (!config.webhookUrl) throw new Error('send_discord_message: "webhookUrl" is required');

  const content = renderTemplate(config.content ?? '⚡ Workflow triggered: {triggerType}', triggerData);

  const res = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) throw new Error(`Discord webhook responded ${res.status}`);
  return `Discord message sent (${content.length} chars)`;
};
