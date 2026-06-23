import type { ActionHandler } from './types';

/**
 * A no-op action that simply records that the trigger fired. The execution log
 * is always written by the executor, so this just contributes a detail line.
 */
export const storeLog: ActionHandler = async (_config, triggerData) => {
  return `Logged trigger ${triggerData.triggerType}${
    triggerData.signature ? ` (sig ${String(triggerData.signature).slice(0, 12)}…)` : ''
  }`;
};
