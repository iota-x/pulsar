import type { ActionHandler } from './types';

/** POST (or other method) the trigger data to an arbitrary URL. */
export const sendWebhook: ActionHandler = async (config, triggerData) => {
  if (!config.url) throw new Error('send_webhook: "url" is required');

  const method = config.method ?? 'POST';
  const res = await fetch(config.url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(config.headers ?? {}) },
    body: method === 'GET' ? undefined : JSON.stringify({ triggerData }),
  });

  if (!res.ok) throw new Error(`Webhook responded ${res.status} ${res.statusText}`);
  return `Webhook ${method} ${config.url} → ${res.status}`;
};
