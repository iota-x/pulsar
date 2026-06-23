import prisma from '../prisma/client';
import { AppError } from '../middlewares/errorHandler';

/** All execution logs across the user's workflows (newest first). */
export const getAllLogs = async (userId: string) => {
  return prisma.log.findMany({
    where: { workflow: { userId } },
    include: { workflow: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
};

/** Execution logs for a single workflow, scoped to its owner. */
export const getLogsByWorkflowId = async (workflowId: string, userId: string) => {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new AppError('Workflow not found', 404);
  if (workflow.userId !== userId) throw new AppError('Forbidden', 403);

  return prisma.log.findMany({ where: { workflowId }, orderBy: { createdAt: 'desc' } });
};
