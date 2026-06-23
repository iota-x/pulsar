import prisma from '../prisma/client';
import { AppError } from '../middlewares/errorHandler';
import type { CreateWorkflowInput, UpdateWorkflowInput } from '../validation/schemas';

const withRelations = {
  trigger: true,
  actions: { orderBy: { order: 'asc' as const } },
};

/** Ensure the workflow exists and belongs to the user; returns it or throws. */
const assertOwnership = async (id: string, userId: string) => {
  const workflow = await prisma.workflow.findUnique({ where: { id } });
  if (!workflow) throw new AppError('Workflow not found', 404);
  if (workflow.userId !== userId) throw new AppError('Forbidden', 403);
  return workflow;
};

/** Create a workflow together with its trigger and ordered actions. */
export const createWorkflow = async (userId: string, input: CreateWorkflowInput) => {
  return prisma.workflow.create({
    data: {
      userId,
      name: input.name,
      description: input.description,
      isActive: input.isActive ?? true,
      trigger: { create: { type: input.trigger.type, config: input.trigger.config } },
      actions: {
        create: input.actions.map((a, order) => ({ type: a.type, config: a.config, order })),
      },
    },
    include: withRelations,
  });
};

export const getAllWorkflows = async (userId: string) => {
  return prisma.workflow.findMany({
    where: { userId },
    include: { trigger: true, _count: { select: { actions: true, logs: true } } },
    orderBy: { createdAt: 'desc' },
  });
};

export const getWorkflowById = async (id: string, userId: string) => {
  await assertOwnership(id, userId);
  return prisma.workflow.findUnique({
    where: { id },
    include: {
      ...withRelations,
      logs: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
};

/** Update workflow metadata and, if provided, replace its trigger/actions. */
export const updateWorkflow = async (id: string, userId: string, input: UpdateWorkflowInput) => {
  await assertOwnership(id, userId);

  return prisma.$transaction(async (tx) => {
    await tx.workflow.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        isActive: input.isActive,
      },
    });

    if (input.trigger) {
      await tx.trigger.upsert({
        where: { workflowId: id },
        create: { workflowId: id, type: input.trigger.type, config: input.trigger.config },
        update: { type: input.trigger.type, config: input.trigger.config },
      });
    }

    if (input.actions) {
      await tx.action.deleteMany({ where: { workflowId: id } });
      await tx.action.createMany({
        data: input.actions.map((a, order) => ({
          workflowId: id,
          type: a.type,
          config: a.config,
          order,
        })),
      });
    }

    return tx.workflow.findUnique({ where: { id }, include: withRelations });
  });
};

export const setActive = async (id: string, userId: string, isActive: boolean) => {
  await assertOwnership(id, userId);
  return prisma.workflow.update({ where: { id }, data: { isActive }, include: withRelations });
};

export const deleteWorkflow = async (id: string, userId: string) => {
  await assertOwnership(id, userId);
  return prisma.workflow.delete({ where: { id } });
};

/** Aggregate counts powering the dashboard cards. */
export const getDashboardStats = async (userId: string) => {
  const [total, active, recent, failed] = await Promise.all([
    prisma.workflow.count({ where: { userId } }),
    prisma.workflow.count({ where: { userId, isActive: true } }),
    prisma.log.findMany({
      where: { workflow: { userId } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { workflow: { select: { name: true } } },
    }),
    prisma.log.count({ where: { workflow: { userId }, status: 'failed' } }),
  ]);

  return { totalWorkflows: total, activeWorkflows: active, failedExecutions: failed, recentExecutions: recent };
};
