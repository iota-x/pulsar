import {
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getMint,
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
} from '@solana/spl-token';
import type { ActionHandler } from './types';
import { connection, getSigner, explorerUrl, toPublicKey } from '../solana';

/**
 * Send tokens on Solana for real. With no `mint` it transfers native SOL; with
 * a `mint` it transfers that SPL token (creating the recipient's associated
 * token account if needed, paid for by the signer). `amount` is in UI units.
 */
export const sendTokens: ActionHandler = async (config) => {
  const signer = getSigner();
  if (!signer) {
    throw new Error('send_tokens: no signer configured (set SOLANA_SIGNER_SECRET_KEY)');
  }
  if (!config.to) throw new Error('send_tokens: "to" is required');
  const amount = Number(config.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('send_tokens: valid "amount" is required');

  const recipient = toPublicKey(config.to, 'send_tokens recipient');

  // --- Native SOL transfer ---
  if (!config.mint) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: recipient,
        lamports: Math.round(amount * LAMPORTS_PER_SOL),
      }),
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
    return `Sent ${amount} SOL to ${config.to} — ${explorerUrl(sig)}`;
  }

  // --- SPL token transfer ---
  const mint = toPublicKey(config.mint, 'send_tokens mint');
  const mintInfo = await getMint(connection, mint);
  const rawAmount = BigInt(Math.round(amount * 10 ** mintInfo.decimals));

  const source = await getOrCreateAssociatedTokenAccount(connection, signer, mint, signer.publicKey);
  const dest = await getOrCreateAssociatedTokenAccount(connection, signer, mint, recipient);

  const tx = new Transaction().add(
    createTransferInstruction(source.address, dest.address, signer.publicKey, rawAmount),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
  return `Sent ${amount} of ${config.mint} to ${config.to} — ${explorerUrl(sig)}`;
};
