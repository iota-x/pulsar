/**
 * Per-cluster on-chain config — the single source of truth for every address
 * that differs between devnet and mainnet. Going live becomes a config flip:
 * point SOLANA_RPC_URL at mainnet and these resolve automatically (an explicit
 * env override always wins, for custom RPCs or relocated programs).
 *
 * What does NOT live here (it's operator-specific, not cluster-specific):
 *   - WEB3_ZAPIER_PROGRAM_ID / TREASURY_PUBKEY — set per deployment via env.
 */

import type { Cluster } from './capabilities';
import { clusterFromRpc } from './capabilities';

export interface NetworkConfig {
  cluster: Cluster;
  /** Canonical public RPC for the cluster — a fallback when none is configured. */
  defaultRpc: string;
  /** Metaplex Token Metadata program (same address on every cluster). */
  metaplexTokenMetadata: string;
  /** Raydium CPMM program — differs devnet vs mainnet. */
  raydiumCpmmProgram: string;
  /** Wormhole Core Bridge — differs devnet vs mainnet. */
  wormholeCoreBridge: string;
}

const METAPLEX_TOKEN_METADATA = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

const MAINNET: NetworkConfig = {
  cluster: 'mainnet-beta',
  defaultRpc: 'https://api.mainnet-beta.solana.com',
  metaplexTokenMetadata: METAPLEX_TOKEN_METADATA,
  raydiumCpmmProgram: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  wormholeCoreBridge: 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',
};

const DEVNET: NetworkConfig = {
  cluster: 'devnet',
  defaultRpc: 'https://api.devnet.solana.com',
  metaplexTokenMetadata: METAPLEX_TOKEN_METADATA,
  raydiumCpmmProgram: 'DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb',
  wormholeCoreBridge: '3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5',
};

export const NETWORKS: Record<Cluster, NetworkConfig> = {
  'mainnet-beta': MAINNET,
  devnet: DEVNET,
  // testnet/localnet aren't first-class targets — reuse devnet's program set.
  testnet: { ...DEVNET, cluster: 'testnet' },
  localnet: { ...DEVNET, cluster: 'localnet' },
};

/**
 * Resolve the active network config from an RPC URL (defaults to the
 * SOLANA_RPC_URL env, then devnet). The cluster is derived from the URL, so the
 * whole stack follows a single SOLANA_RPC_URL change.
 */
export function resolveNetwork(rpcUrl?: string): NetworkConfig {
  const url = rpcUrl ?? process.env.SOLANA_RPC_URL ?? DEVNET.defaultRpc;
  return NETWORKS[clusterFromRpc(url)];
}
