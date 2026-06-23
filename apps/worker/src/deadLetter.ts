import type { ExecutionJob, LogStatus } from '@web3-zapier/shared';
import prisma from './prisma';
import { notifyFailure } from './notify';

/**
 * Record a terminal queue failure (all retries exhausted) as a visible
 * dead-letter execution, and alert. Most action errors are caught inside the
 * executor and logged as partial/failed; this catches the rarer case where the
 * whole job threw (DB/RPC outage, claim error) so it never vanishes silently.
 */
export async function deadLetter(job: ExecutionJob | undefined, error: string): Promise<void> {
  if (!job) return;
  try {
    const data = {
      status: 'dead_letter' satisfies LogStatus,
      message: `Retries exhausted: ${error}`.slice(0, 500),
      finishedAt: new Date(),
    };
    // Update the claimed running row if present, else create a standalone record.
    if (job.dedupeKey) {
      const existing = await prisma.log.findUnique({ where: { dedupeKey: job.dedupeKey }, select: { id: true } });
      if (existing) {
        await prisma.log.update({ where: { id: existing.id }, data });
      } else {
        await prisma.log.create({
          data: {
            ...data,
            workflowId: job.workflowId,
            triggerType: job.triggerData?.triggerType,
            triggerData: job.triggerData as object,
            dedupeKey: job.dedupeKey,
          },
        });
      }
    }
    const wf = await prisma.workflow.findUnique({ where: { id: job.workflowId }, select: { name: true } });
    await notifyFailure(wf?.name ?? job.workflowId, 'dead_letter', [
      { actionId: 'job', type: 'store_log' as never, status: 'failed', detail: error },
    ]).catch(() => {});
  } catch (e) {
    console.error('[deadLetter] failed to record:', e instanceof Error ? e.message : e);
  }
}
