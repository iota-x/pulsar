import { createMint } from '@solana/spl-token';
import type { ActionHandler } from './types';
import { connection, getSigner, explorerAddress } from '../solana';

/**
 * Deploy a new on-chain "contract". On Solana the natural no-code analogue of
 * deploying a token contract is creating a new SPL mint (a fresh token program
 * instance), with the signer as mint + freeze authority. `decimals` defaults to 6.
 *
 * (Deploying an arbitrary BPF program from a workflow is intentionally not done —
 * it needs a compiled binary, buffer accounts and ~1.5 SOL, and is unsafe to
 * automate.)
 */
export const deployContract: ActionHandler = async (config) => {
  const signer = getSigner();
  if (!signer) throw new Error('deploy_contract: no signer configured (set SOLANA_SIGNER_SECRET_KEY)');

  const decimals = Number(config.decimals ?? 6);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
    throw new Error('deploy_contract: "decimals" must be an integer 0–9');
  }

  const mint = await createMint(connection, signer, signer.publicKey, signer.publicKey, decimals);
  return `Deployed a new SPL token contract (mint ${mint.toBase58()}) — ${explorerAddress(mint.toBase58())}`;
};
