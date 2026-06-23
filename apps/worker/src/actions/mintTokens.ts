import { getMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import type { ActionHandler } from './types';
import { connection, getSigner, explorerUrl, toPublicKey } from '../solana';

/**
 * Mint new SPL tokens to a recipient. The worker's signer must be the mint
 * authority. `amount` is in UI units (converted using the mint's decimals).
 */
export const mintTokens: ActionHandler = async (config) => {
  const signer = getSigner();
  if (!signer) throw new Error('mint_tokens: no signer configured (set SOLANA_SIGNER_SECRET_KEY)');
  if (!config.mint) throw new Error('mint_tokens: "mint" is required');
  if (!config.to) throw new Error('mint_tokens: "to" is required');
  const amount = Number(config.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('mint_tokens: valid "amount" is required');

  const mint = toPublicKey(config.mint, 'mint_tokens mint');
  const recipient = toPublicKey(config.to, 'mint_tokens recipient');

  const mintInfo = await getMint(connection, mint);
  const rawAmount = BigInt(Math.round(amount * 10 ** mintInfo.decimals));

  // Ensure the recipient has an associated token account, then mint into it.
  const ata = await getOrCreateAssociatedTokenAccount(connection, signer, mint, recipient);
  const sig = await mintTo(connection, signer, mint, ata.address, signer, rawAmount);

  return `Minted ${amount} of ${config.mint} to ${config.to} — ${explorerUrl(sig)}`;
};
