import {
  type ExecutionJob,
  type ActionResult,
  type ActionConfig,
  type LogStatus,
  isActionType,
  dedupeKeyFor,
  planAction,
  ACTION_BY_TYPE,
} from '@web3-zapier/shared';
import prisma from './prisma';
import { actionHandlers } from './actions';
import { notifyFailure } from './notify';

/** Postgres unique-constraint violation (a duplicate dedupeKey claim). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/**
 * Load a workflow, run its actions in order, and persist an execution log.
 *
 * Individual action failures don't abort the run — they're recorded and the
 * overall status becomes "partial" (or "failed" if everything failed). Action
 * types without an off-chain handler are recorded as "simulated" (selectable
 * and logged, but real execution needs the on-chain signer).
 */
export async function executeWorkflow(job: ExecutionJob): Promise<void> {
  const { workflowId, triggerData, dryRun } = job;

  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: {
      actions: { orderBy: { order: 'asc' } },
      user: { select: { walletAddress: true } },
    },
  });

  if (!workflow) {
    console.warn(`[executor] workflow ${workflowId} not found, skipping`);
    return;
  }
  if (!workflow.isActive && !dryRun) {
    console.log(`[executor] workflow ${workflowId} is inactive, skipping`);
    return;
  }

  // Dry-run: validate + describe, never touch the chain, never persist a log.
  if (dryRun) {
    const plan = workflow.actions.map((action) => describeAction(action.id, action.type, action.config));
    console.log(`[executor] dry-run workflow ${workflowId}: ${plan.length} action(s)`);
    return;
  }

  // Exactly-once claim: insert the running record keyed by dedupeKey. A unique
  // violation means another worker/retry already handled this event → skip.
  const dedupeKey = job.dedupeKey ?? dedupeKeyFor(workflowId, triggerData);
  let logId: string;
  try {
    const claim = await prisma.log.create({
      data: {
        workflowId,
        status: 'running' satisfies LogStatus,
        triggerType: triggerData.triggerType,
        triggerData: triggerData as object,
        dedupeKey,
      },
      select: { id: true },
    });
    logId = claim.id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      console.log(`[executor] duplicate event ${dedupeKey}, skipping (already executed)`);
      return;
    }
    throw err;
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
      const config = { ...((action.config as Record<string, unknown>) ?? {}) } as ActionConfig;
      // Delegated mode: bind the owner to the workflow author's VERIFIED wallet
      // (server-trusted) — never trust a client-supplied owner.
      if (config.useDelegation) {
        if (!workflow.user.walletAddress) throw new Error('No wallet linked to this account for delegated actions');
        config.owner = workflow.user.walletAddress;
      }
      const detail = await handler(config, triggerData);
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

  await prisma.log.update({
    where: { id: logId },
    data: {
      status,
      message: `${succeeded}/${results.length} actions succeeded`,
      resultData: results as object,
      finishedAt: new Date(),
    },
  });

  if (failures > 0) {
    await notifyFailure(workflow.name, status, results).catch((e) =>
      console.error('[executor] failure-alert error:', e instanceof Error ? e.message : e),
    );
  }

  console.log(`[executor] workflow ${workflowId} → ${status}`);
}

/** Describe what an action WOULD do, for dry-run plans (no execution). */
function describeAction(actionId: string, type: string, config: unknown): ActionResult {
  const p = planAction(type, (config as Record<string, unknown>) ?? {});
  return { actionId, type: p.type as ActionResult['type'], status: p.status, detail: p.detail };
}
