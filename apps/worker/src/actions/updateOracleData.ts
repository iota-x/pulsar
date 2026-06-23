import type { ActionHandler } from './types';
import { callUpdateData } from '../anchorProgram';

/**
 * Publish a value to the on-chain data feed via our web3_zapier program.
 * The feed is keyed by `oracle` and owned by the signer.
 */
export const updateOracleData: ActionHandler = async (config) => {
  const key = (config.oracle as string) || 'oracle';
  if (config.value == null || config.value === '') throw new Error('update_oracle_data: "value" is required');
  const value = String(config.value);

  const url = await callUpdateData(key.slice(0, 32), value);
  return `Oracle "${key}" set to "${value}" on-chain — ${url}`;
};
