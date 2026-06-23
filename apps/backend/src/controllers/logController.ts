import { Response } from 'express';
import * as logService from '../services/logService';
import { asyncHandler } from '../middlewares/errorHandler';
import { AuthedRequest } from '../middlewares/authMiddleware';

export const getAllLogs = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const logs = await logService.getAllLogs(req.userId!);
  res.status(200).json(logs);
});

export const getLogsByWorkflowId = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const logs = await logService.getLogsByWorkflowId(req.params.workflowId, req.userId!);
  res.status(200).json(logs);
});
