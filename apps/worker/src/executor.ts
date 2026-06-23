import {
  type ExecutionJob,
  type ActionResult,
  type ActionConfig,
  type LogStatus,
  isActionType,
  ACTION_BY_TYPE,
} from '@web3-zapier/shared';
import prisma from './prisma';
import { actionHandlers } from './actions';

/**
 * Load a workflow, run its actions in order, and persist an execution log.
 *
 * Individual action failures don't abort the run — they're recorded and the
 * overall status becomes "partial" (or "failed" if everything failed). Action
 * types without an off-chain handler are recorded as "simulated" (selectable
 * and logged, but real execution needs the on-chain signer).
 */
export async function executeWorkflow(job: ExecutionJob): Promise<void> {
  const { workflowId, triggerData } = job;

  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: { actions: { orderBy: { order: 'asc' } } },
  });

  if (!workflow) {
    console.warn(`[executor] workflow ${workflowId} not found, skipping`);
    return;
  }
  if (!workflow.isActive) {
    console.log(`[executor] workflow ${workflowId} is inactive, skipping`);
    return;
  }

  const results: ActionResult[] = [];

  for (const action of workflow.actions) {
    if (!isActionType(action.type)) {
      results.push({ actionId: action.id, type: action.type as never, status: 'failed', detail: 'Unknown action type' });
      continue;
    }

    const handler = actionHandlers[action.type];

    // No off-chain handler → record as simulated rather than pretending to run.
    if (!handler) {
      const entry = ACTION_BY_TYPE[action.type];
      const reason =
        entry.implementation === 'smart_contract'
          ? 'requires on-chain signer (Anchor program)'
          : 'not yet implemented';
      const detail = `Simulated "${entry.label}" — ${reason}`;
      results.push({ actionId: action.id, type: action.type, status: 'simulated', detail });
      console.log(`[executor] ~ ${action.type}: ${detail}`);
      continue;
    }

    try {
      const detail = await handler((action.config ?? {}) as ActionConfig, triggerData);
      results.push({ actionId: action.id, type: action.type, status: 'success', detail });
      console.log(`[executor] ✓ ${action.type}: ${detail}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error';
      results.push({ actionId: action.id, type: action.type, status: 'failed', detail });
      console.error(`[executor] ✗ ${action.type}: ${detail}`);
    }
  }

  const failures = results.filter((r) => r.status === 'failed').length;
  const succeeded = results.length - failures;
  const status: LogStatus =
    failures === 0 ? 'success' : succeeded === 0 ? 'failed' : 'partial';

  await prisma.log.create({
    data: {
      workflowId,
      status,
      message: `${succeeded}/${results.length} actions succeeded`,
      triggerData: triggerData as object,
      resultData: results as object,
    },
  });

  console.log(`[executor] workflow ${workflowId} → ${status}`);
}
