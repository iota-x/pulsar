import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { solanaWsUrl } from '@web3-zapier/shared';

export const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

// Pin the ws endpoint to (a derivative of) the RPC so a dedicated provider is
// used for subscriptions too, not just HTTP calls.
export const connection = new Connection(RPC_URL, {
  commitment: 'confirmed',
  wsEndpoint: solanaWsUrl(RPC_URL, process.env.SOLANA_WS_URL),
});

let signer: Keypair | null | undefined;

/**
 * Load the worker's signing keypair from SOLANA_SIGNER_SECRET_KEY. Supports both
 * the `solana-keygen` JSON-array format (`[12,34,...]`) and a base58 string.
 * Returns null (cached) when no signer is configured, so on-chain actions can
 * fail/fall back gracefully instead of crashing the worker.
 */
export function getSigner(): Keypair | null {
  if (signer !== undefined) return signer;

  const raw = process.env.SOLANA_SIGNER_SECRET_KEY?.trim();
  if (!raw) {
    signer = null;
    return signer;
  }

  try {
    const bytes = raw.startsWith('[')
      ? Uint8Array.from(JSON.parse(raw) as number[])
      : bs58.decode(raw);
    signer = Keypair.fromSecretKey(bytes);
    console.log(`[solana] signer loaded: ${signer.publicKey.toBase58()}`);
  } catch (err) {
    console.error('[solana] failed to load SOLANA_SIGNER_SECRET_KEY:', err);
    signer = null;
  }
  return signer;
}

/** Parse a base58 address into a PublicKey, throwing a clear labelled error. */
export function toPublicKey(value: unknown, label: string): PublicKey {
  try {
    return new PublicKey(value as string);
  } catch {
    throw new Error(`invalid ${label}: ${String(value)}`);
  }
}

function clusterQuery(): string {
  return RPC_URL.includes('devnet')
    ? '?cluster=devnet'
    : RPC_URL.includes('testnet')
      ? '?cluster=testnet'
      : '';
}

/** Block explorer URL for a signature on the active cluster. */
export function explorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${clusterQuery()}`;
}

/** Block explorer URL for an account/address on the active cluster. */
export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}${clusterQuery()}`;
}
