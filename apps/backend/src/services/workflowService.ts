import prisma from '../prisma/client';
import { AppError } from '../middlewares/errorHandler';
import type { CreateWorkflowInput, UpdateWorkflowInput } from '../validation/schemas';
import {
  isActionAvailable,
  isTriggerAvailable,
  toSupportedNetwork,
  type SupportedNetwork,
  type ActionType,
  type TriggerType,
} from '@web3-zapier/shared';

const withRelations = {
  trigger: true,
  actions: { orderBy: { order: 'asc' as const } },
};

/** Mainnet is only offered when the deployment has a mainnet RPC configured. */
const mainnetEnabled = () => Boolean(process.env.SOLANA_RPC_URL_MAINNET?.trim());

/**
 * Server-side capability gate — the client's picker filtering is a convenience,
 * never a guarantee. Reject any trigger/action that can't run on the chosen
 * network (mainnet is off-chain only; see NETWORK_CUSTODY_POLICY).
 */
const assertNetworkAllowed = (
  network: SupportedNetwork,
  trigger: { type: string } | null | undefined,
  actions: { type: string }[] | null | undefined,
) => {
  if (network === 'mainnet-beta' && !mainnetEnabled()) {
    throw new AppError('Mainnet is not enabled on this deployment', 400);
  }
  if (trigger && !isTriggerAvailable(trigger.type as TriggerType, network)) {
    throw new AppError(`Trigger "${trigger.type}" is not available on ${network}`, 400);
  }
  for (const a of actions ?? []) {
    if (!isActionAvailable(a.type as ActionType, network)) {
      throw new AppError(`Action "${a.type}" is not available on ${network}`, 400);
    }
  }
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
  const network = toSupportedNetwork(input.network);
  assertNetworkAllowed(network, input.trigger, input.actions);

  return prisma.workflow.create({
    data: {
      userId,
      name: input.name,
      description: input.description,
      isActive: input.isActive ?? true,
      network,
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
  const existing = await prisma.workflow.findUnique({ where: { id }, include: withRelations });
  if (!existing) throw new AppError('Workflow not found', 404);
  if (existing.userId !== userId) throw new AppError('Forbidden', 403);

  // Validate the resulting workflow: the incoming network (or the current one),
  // against the incoming trigger/actions (or the ones already stored). This
  // catches "switch an existing devnet workflow to mainnet" even when the
  // trigger/actions aren't re-sent.
  const network = toSupportedNetwork(input.network ?? existing.network);
  assertNetworkAllowed(network, input.trigger ?? existing.trigger, input.actions ?? existing.actions);

  return prisma.$transaction(async (tx) => {
    await tx.workflow.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        isActive: input.isActive,
        network: input.network,
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
