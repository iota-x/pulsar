import { getOrCreateAssociatedTokenAccount, transfer } from '@solana/spl-token';
import type { ActionHandler } from './types';
import { connection, getSigner, explorerUrl, toPublicKey } from '../solana';

/**
 * Transfer an NFT (an SPL token with 0 decimals and supply 1) from the worker's
 * signer to a recipient, creating the recipient's token account if needed.
 */
export const transferNft: ActionHandler = async (config) => {
  const signer = getSigner();
  if (!signer) throw new Error('transfer_nft: no signer configured (set SOLANA_SIGNER_SECRET_KEY)');
  if (!config.mint) throw new Error('transfer_nft: "mint" is required');
  if (!config.to) throw new Error('transfer_nft: "to" is required');

  const mint = toPublicKey(config.mint, 'transfer_nft mint');
  const recipient = toPublicKey(config.to, 'transfer_nft recipient');

  const source = await getOrCreateAssociatedTokenAccount(connection, signer, mint, signer.publicKey);
  const dest = await getOrCreateAssociatedTokenAccount(connection, signer, mint, recipient);

  // NFTs are indivisible: transfer exactly 1 unit.
  const sig = await transfer(connection, signer, source.address, dest.address, signer, 1);

  return `Transferred NFT ${config.mint} to ${config.to} — ${explorerUrl(sig)}`;
};
