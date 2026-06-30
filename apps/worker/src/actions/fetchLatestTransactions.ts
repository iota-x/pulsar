import { Connection, PublicKey } from '@solana/web3.js';
import type { ActionHandler } from './types';

const connection = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed');

/** Fetch the most recent transaction signatures for an address from the chain. */
export const fetchLatestTransactions: ActionHandler = async (config, triggerData) => {
  const address = (config.wallet as string) || (triggerData.wallet as string);
  if (!address) throw new Error('fetch_latest_transactions: "wallet" is required');

  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(address);
  } catch {
    throw new Error(`fetch_latest_transactions: invalid address ${address}`);
  }

  const limit = Math.min(Number(config.limit ?? 10) || 10, 50);
  const sigs = await connection.getSignaturesForAddress(pubkey, { limit });
  return `Fetched ${sigs.length} recent transaction(s) for ${address.slice(0, 8)}…`;
};
