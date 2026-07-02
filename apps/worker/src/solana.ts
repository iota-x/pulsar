import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { solanaWsUrl, type SupportedNetwork } from '@web3-zapier/shared';

export const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const MAINNET_RPC_URL = process.env.SOLANA_RPC_URL_MAINNET?.trim();

// Pin the ws endpoint to (a derivative of) the RPC so a dedicated provider is
// used for subscriptions too, not just HTTP calls. This is the primary (usually
// devnet) connection — the one every on-chain action uses, since fund-moving
// actions are devnet-only under NETWORK_CUSTODY_POLICY.
export const connection = new Connection(RPC_URL, {
  commitment: 'confirmed',
  wsEndpoint: solanaWsUrl(RPC_URL, process.env.SOLANA_WS_URL),
});

const connectionCache = new Map<SupportedNetwork, Connection>();

/**
 * Resolve the Connection for a workflow's network. Devnet (and any non-mainnet)
 * uses the primary `connection`; mainnet gets its own memoized connection from
 * SOLANA_RPC_URL_MAINNET. Only off-chain, chain-reading actions (e.g.
 * fetch_latest_transactions) need this — value-moving actions stay on devnet.
 * Falls back to the primary connection if mainnet isn't configured (mainnet
 * workflows can't be created without it, so this only guards misconfiguration).
 */
export function connectionFor(network: SupportedNetwork): Connection {
  if (network !== 'mainnet-beta') return connection;
  const cached = connectionCache.get('mainnet-beta');
  if (cached) return cached;
  if (!MAINNET_RPC_URL) return connection;
  const conn = new Connection(MAINNET_RPC_URL, {
    commitment: 'confirmed',
    wsEndpoint: solanaWsUrl(MAINNET_RPC_URL, process.env.SOLANA_WS_URL_MAINNET),
  });
  connectionCache.set('mainnet-beta', conn);
  return conn;
}

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
    const bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw);
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

function clusterQuery(network?: SupportedNetwork): string {
  if (network === 'mainnet-beta') return '';
  if (network === 'devnet') return '?cluster=devnet';
  // No explicit network → derive from the primary RPC (back-compat).
  return RPC_URL.includes('devnet') ? '?cluster=devnet' : RPC_URL.includes('testnet') ? '?cluster=testnet' : '';
}

/** Block explorer URL for a signature (on the given network, or the primary cluster). */
export function explorerUrl(signature: string, network?: SupportedNetwork): string {
  return `https://explorer.solana.com/tx/${signature}${clusterQuery(network)}`;
}

/** Block explorer URL for an account/address (on the given network, or the primary cluster). */
export function explorerAddress(address: string, network?: SupportedNetwork): string {
  return `https://explorer.solana.com/address/${address}${clusterQuery(network)}`;
}
