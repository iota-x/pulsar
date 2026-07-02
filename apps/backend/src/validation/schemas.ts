import { z } from 'zod';
import { TRIGGER_TYPES, ACTION_TYPES } from '@web3-zapier/shared';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const triggerInput = z.object({
  type: z.enum(TRIGGER_TYPES),
  config: z.record(z.any()).default({}),
});

const actionInput = z.object({
  type: z.enum(ACTION_TYPES),
  config: z.record(z.any()).default({}),
});

/** Solana cluster a workflow targets. Capability gating lives in workflowService. */
const networkInput = z.enum(['devnet', 'mainnet-beta']);

/** Create a full workflow (trigger + ordered actions) in one request. */
export const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  network: networkInput.default('devnet'),
  trigger: triggerInput,
  actions: z.array(actionInput).min(1, 'At least one action is required'),
});

export const updateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  network: networkInput.optional(),
  trigger: triggerInput.optional(),
  actions: z.array(actionInput).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
