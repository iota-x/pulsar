import type { ActionHandler } from './types';
import { callUpdateData } from '../anchorProgram';

/**
 * Update a field of on-chain contract state via our web3_zapier program.
 * `field` is the key, `value` the new value, owned by the signer.
 */
export const updateContractState: ActionHandler = async (config) => {
  const field = (config.field as string) || 'state';
  if (config.value == null || config.value === '') throw new Error('update_contract_state: "value" is required');
  const value = String(config.value);

  const url = await callUpdateData(field.slice(0, 32), value);
  return `Contract state "${field}" = "${value}" on-chain — ${url}`;
};
