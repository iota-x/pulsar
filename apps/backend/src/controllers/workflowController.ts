import { Response } from 'express';
import { randomUUID } from 'crypto';
import * as workflowService from '../services/workflowService';
import { asyncHandler, AppError } from '../middlewares/errorHandler';
import { createWorkflowSchema, updateWorkflowSchema } from '../validation/schemas';
import { AuthedRequest } from '../middlewares/authMiddleware';
import { enqueueExecution } from '../lib/queue';

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

export const getDashboard = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const stats = await workflowService.getDashboardStats(req.userId!);
  res.status(200).json(stats);
});
