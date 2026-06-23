import type { ActionHandler } from './types';

/**
 * Post a message to a Discord channel via an incoming webhook URL.
 * Supports a few `{placeholders}` resolved from the trigger data.
 */
export const sendDiscordMessage: ActionHandler = async (config, triggerData) => {
  if (!config.webhookUrl) throw new Error('send_discord_message: "webhookUrl" is required');

  const template = config.content ?? '⚡ Workflow triggered: {triggerType}';
  const content = template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = (triggerData as Record<string, unknown>)[key];
    return value == null ? `{${key}}` : String(value);
  });

  const res = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) throw new Error(`Discord webhook responded ${res.status}`);
  return `Discord message sent (${content.length} chars)`;
};
