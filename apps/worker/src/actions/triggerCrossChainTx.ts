import type { ActionHandler } from './types';
import { postCrossChainMessage } from '../wormhole';

/**
 * Initiate a cross-chain transaction by publishing a Wormhole message from
 * Solana. The payload encodes the target chain, recipient and amount; the
 * Wormhole guardians produce a VAA redeemable on the destination chain.
 */
export const triggerCrossChainTx: ActionHandler = async (config, triggerData) => {
  const targetChain = (config.targetChain as string) || 'ethereum';
  const payload = Buffer.from(
    JSON.stringify({
      source: 'solana',
      targetChain,
      to: config.to ?? null,
      amount: config.amount ?? null,
      trigger: triggerData.triggerType,
    }),
    'utf8',
  );

  const url = await postCrossChainMessage(payload);
  return `Cross-chain message to ${targetChain} published via Wormhole — ${url}`;
};
