import type { ActionConfig, TriggerData } from '@web3-zapier/shared';

/**
 * An action handler runs one step of a workflow. It receives the action's
 * stored config and the trigger data that fired the workflow, and returns a
 * short human-readable detail string. Throwing marks the action as failed.
 */
export type ActionHandler = (config: ActionConfig, triggerData: TriggerData) => Promise<string>;
