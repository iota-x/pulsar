import { Response } from 'express';
import { randomUUID } from 'crypto';
import * as workflowService from '../services/workflowService';
import { asyncHandler, AppError } from '../middlewares/errorHandler';
import { createWorkflowSchema, updateWorkflowSchema } from '../validation/schemas';
import { AuthedRequest } from '../middlewares/authMiddleware';
import { enqueueExecution } from '../lib/queue';
import { isActionType, ACTION_BY_TYPE } from '@web3-zapier/shared';

export const createWorkflow = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const input = createWorkflowSchema.parse(req.body);
  const workflow = await workflowService.createWorkflow(req.userId!, input);
  res.status(201).json(workflow);
});

export const getAllWorkflows = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const workflows = await workflowService.getAllWorkflows(req.userId!);
  res.status(200).json(workflows);
});

export const getWorkflowById = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const workflow = await workflowService.getWorkflowById(req.params.id, req.userId!);
  res.status(200).json(workflow);
});

export const updateWorkflow = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const input = updateWorkflowSchema.parse(req.body);
  const workflow = await workflowService.updateWorkflow(req.params.id, req.userId!, input);
  res.status(200).json(workflow);
});

export const toggleWorkflow = asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (typeof req.body?.isActive !== 'boolean') throw new AppError('isActive (boolean) is required');
  const workflow = await workflowService.setActive(req.params.id, req.userId!, req.body.isActive);
  res.status(200).json(workflow);
});

export const deleteWorkflow = asyncHandler(async (req: AuthedRequest, res: Response) => {
  await workflowService.deleteWorkflow(req.params.id, req.userId!);
  res.status(204).send();
});

/** Manually enqueue a workflow run for testing, with synthetic trigger data. */
export const runWorkflow = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const workflow = await workflowService.getWorkflowById(req.params.id, req.userId!);
  if (!workflow) throw new AppError('Workflow not found', 404);
  await enqueueExecution({
    workflowId: workflow.id,
    triggerData: {
      triggerType: (workflow.trigger?.type as any) ?? 'transaction_confirmed',
      manual: true,
      // Unique per click so manual test runs always execute (never deduped).
      detectedAt: `manual-${Date.now()}-${randomUUID()}`,
      ...(req.body?.triggerData ?? {}),
    },
  });
  res.status(202).json({ message: 'Workflow execution enqueued' });
});

/**
 * Dry-run: validate each action's required config and describe what it WOULD do,
 * synchronously and without touching the chain or external services. Lets users
 * sanity-check a workflow before arming it.
 */
export const simulateWorkflow = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const workflow = await workflowService.getWorkflowById(req.params.id, req.userId!);
  if (!workflow) throw new AppError('Workflow not found', 404);

  const plan = (workflow.actions ?? []).map((action) => {
    if (!isActionType(action.type)) {
      return { type: action.type, status: 'failed' as const, detail: 'Unknown action type' };
    }
    const entry = ACTION_BY_TYPE[action.type];
    const cfg = (action.config as Record<string, unknown>) ?? {};
    const missing = entry.fields.filter((f) => f.required).map((f) => f.key).filter((k) => cfg[k] === undefined || cfg[k] === '');
    if (missing.length > 0) {
      return { type: action.type, status: 'failed' as const, detail: `Missing required: ${missing.join(', ')}` };
    }
    return { type: action.type, status: 'simulated' as const, detail: `Would ${entry.label.toLowerCase()}` };
  });

  res.status(200).json({
    workflowId: workflow.id,
    triggerType: workflow.trigger?.type ?? null,
    ok: plan.every((p) => p.status !== 'failed'),
    plan,
  });
});

export const getDashboard = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const stats = await workflowService.getDashboardStats(req.userId!);
  res.status(200).json(stats);
});
