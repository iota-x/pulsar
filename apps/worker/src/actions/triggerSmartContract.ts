import type { ActionHandler } from './types';
import { callPing } from '../anchorProgram';

/**
 * Invoke our web3_zapier program's `ping` instruction, emitting an on-chain
 * Triggered event. `instruction` is used as the event label.
 */
export const triggerSmartContract: ActionHandler = async (config, triggerData) => {
  const label = ((config.instruction as string) || triggerData.triggerType || 'triggered').slice(0, 64);
  const url = await callPing(label);
  return `Triggered on-chain program (ping "${label}") — ${url}`;
};
