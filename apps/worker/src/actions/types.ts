import type { ActionConfig, TriggerData, SupportedNetwork } from '@web3-zapier/shared';

/** Per-execution context an action may need (e.g. which cluster to read/write). */
export interface ActionContext {
  /** The workflow's Solana network — pick the matching connection with connectionFor(). */
  network: SupportedNetwork;
}

/**
 * An action handler runs one step of a workflow. It receives the action's
 * stored config, the trigger data that fired the workflow, and the execution
 * context (network), and returns a short human-readable detail string. Throwing
 * marks the action as failed. Off-chain handlers can ignore `ctx`.
 */
export type ActionHandler = (
  config: ActionConfig,
  triggerData: TriggerData,
  ctx: ActionContext,
) => Promise<string>;
