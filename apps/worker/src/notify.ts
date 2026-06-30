import type { ActionResult, LogStatus } from '@web3-zapier/shared';

/**
 * Alert on a failed/partial workflow run. Posts to a Discord-compatible webhook
 * if FAILURE_WEBHOOK_URL is set; always logs. Best-effort — never throws into
 * the executor (callers swallow errors).
 */
export async function notifyFailure(workflowName: string, status: LogStatus, results: ActionResult[]): Promise<void> {
  const failed = results.filter((r) => r.status === 'failed');
  const lines = failed.map((r) => `• ${r.type}: ${r.detail ?? 'failed'}`).join('\n');
  const summary = `⚠️ Workflow "${workflowName}" ${status} — ${failed.length} action(s) failed:\n${lines}`;

  console.error(`[notify] ${summary.replace(/\n/g, ' ')}`);

  const url = process.env.FAILURE_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: summary.slice(0, 1900) }),
  });
}
