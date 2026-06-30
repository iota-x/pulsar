import { SystemProgram, Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import type { ActionHandler } from './types';
import { connection, getSigner, explorerUrl, toPublicKey } from '../solana';

/**
 * Distribute native SOL across multiple wallets in a single transaction.
 * `targets` is a JSON array of `{ "to": "<addr>", "amount": <SOL> }`.
 */
export const allocateFunds: ActionHandler = async (config) => {
  const signer = getSigner();
  if (!signer) throw new Error('allocate_funds: no signer configured (set SOLANA_SIGNER_SECRET_KEY)');

  let targets = config.targets as unknown;
  if (typeof targets === 'string') targets = JSON.parse(targets);
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error('allocate_funds: "targets" must be a non-empty JSON array of { to, amount }');
  }

  const tx = new Transaction();
  let total = 0;
  for (const t of targets as Array<{ to: string; amount: number }>) {
    const amount = Number(t.amount);
    if (!t.to || !Number.isFinite(amount) || amount <= 0)
      throw new Error('allocate_funds: each target needs "to" and a positive "amount"');
    tx.add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: toPublicKey(t.to, 'allocate target'),
        lamports: Math.round(amount * LAMPORTS_PER_SOL),
      }),
    );
    total += amount;
  }

  const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
  return `Allocated ${total} SOL across ${(targets as unknown[]).length} recipient(s) — ${explorerUrl(sig)}`;
};
