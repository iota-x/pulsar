import { getMint, getAssociatedTokenAddress, burn } from '@solana/spl-token';
import type { ActionHandler } from './types';
import { connection, getSigner, explorerUrl, toPublicKey } from '../solana';

/**
 * Burn SPL tokens held by the worker's signer. `amount` is in UI units
 * (converted using the mint's decimals).
 */
export const burnTokens: ActionHandler = async (config) => {
  const signer = getSigner();
  if (!signer) throw new Error('burn_tokens: no signer configured (set SOLANA_SIGNER_SECRET_KEY)');
  if (!config.mint) throw new Error('burn_tokens: "mint" is required');
  const amount = Number(config.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('burn_tokens: valid "amount" is required');

  const mint = toPublicKey(config.mint, 'burn_tokens mint');
  const mintInfo = await getMint(connection, mint);
  const rawAmount = BigInt(Math.round(amount * 10 ** mintInfo.decimals));

  const tokenAccount = await getAssociatedTokenAddress(mint, signer.publicKey);
  const sig = await burn(connection, signer, tokenAccount, mint, signer, rawAmount);

  return `Burned ${amount} of ${config.mint} — ${explorerUrl(sig)}`;
};
