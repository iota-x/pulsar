import { PublicKey } from '@solana/web3.js';
import type { ActionHandler } from './types';
import { connectionFor } from '../solana';

/** Fetch the most recent transaction signatures for an address from the chain. */
export const fetchLatestTransactions: ActionHandler = async (config, triggerData, ctx) => {
  const address = (config.wallet as string) || (triggerData.wallet as string);
  if (!address) throw new Error('fetch_latest_transactions: "wallet" is required');

  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(address);
  } catch {
    throw new Error(`fetch_latest_transactions: invalid address ${address}`);
  }

  // Read from the workflow's own cluster — this is the one off-chain action that
  // meaningfully runs on mainnet as well as devnet.
  const limit = Math.min(Number(config.limit ?? 10) || 10, 50);
  const sigs = await connectionFor(ctx.network).getSignaturesForAddress(pubkey, { limit });
  return `Fetched ${sigs.length} recent transaction(s) for ${address.slice(0, 8)}…`;
};
