import {
  Keypair,
  PublicKey,
  Transaction,
  StakeProgram,
  Authorized,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import type { ActionHandler } from './types';
import { connection, getSigner, explorerUrl, toPublicKey } from '../solana';

/**
 * Stake or unstake native SOL via the Stake Program.
 *
 *   mode: 'stake'   → create a stake account funded with `amount` SOL and
 *                     delegate it to `validator` (a vote account; auto-picked
 *                     from the cluster if omitted). Returns the new stake
 *                     account address — keep it to unstake later.
 *   mode: 'unstake' → deactivate the stake account in `stakeAccount`. Funds
 *                     become withdrawable after the deactivation epoch.
 */
export const stakeUnstake: ActionHandler = async (config) => {
  const signer = getSigner();
  if (!signer) throw new Error('stake_unstake_tokens: no signer configured (set SOLANA_SIGNER_SECRET_KEY)');

  const mode = (config.mode as string) || 'stake';

  if (mode === 'unstake') {
    if (!config.stakeAccount) throw new Error('stake_unstake_tokens: "stakeAccount" is required to unstake');
    const stakePubkey = toPublicKey(config.stakeAccount, 'stakeAccount');
    const tx = StakeProgram.deactivate({ stakePubkey, authorizedPubkey: signer.publicKey });
    const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
    return `Deactivated stake account ${config.stakeAccount} (withdrawable next epoch) — ${explorerUrl(sig)}`;
  }

  // --- stake ---
  const amount = Number(config.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('stake_unstake_tokens: valid "amount" is required to stake');

  // The Stake program enforces a network minimum delegation (1 SOL on most
  // clusters). Check it up-front so the user gets a clear message.
  const { value: minDelegationLamports } = await connection.getStakeMinimumDelegation();
  const minSol = minDelegationLamports / LAMPORTS_PER_SOL;
  if (amount * LAMPORTS_PER_SOL < minDelegationLamports) {
    throw new Error(`stake_unstake_tokens: amount ${amount} SOL is below the network minimum delegation of ${minSol} SOL`);
  }

  // Resolve the validator vote account (explicit, or the first active one).
  let votePubkey: PublicKey;
  if (config.validator) {
    votePubkey = toPublicKey(config.validator, 'validator');
  } else {
    const { current } = await connection.getVoteAccounts();
    if (current.length === 0) throw new Error('stake_unstake_tokens: no active validators found');
    votePubkey = new PublicKey(current[0].votePubkey);
  }

  const stakeAccount = Keypair.generate();
  const rentExempt = await connection.getMinimumBalanceForRentExemption(StakeProgram.space);
  const lamports = rentExempt + Math.round(amount * LAMPORTS_PER_SOL);

  const tx = new Transaction()
    .add(
      StakeProgram.createAccount({
        fromPubkey: signer.publicKey,
        stakePubkey: stakeAccount.publicKey,
        authorized: new Authorized(signer.publicKey, signer.publicKey),
        lamports,
      }),
    )
    .add(
      StakeProgram.delegate({
        stakePubkey: stakeAccount.publicKey,
        authorizedPubkey: signer.publicKey,
        votePubkey,
      }),
    );

  const sig = await sendAndConfirmTransaction(connection, tx, [signer, stakeAccount]);
  return `Staked ${amount} SOL → validator ${votePubkey.toBase58().slice(0, 8)}…, stake account ${stakeAccount.publicKey.toBase58()} — ${explorerUrl(sig)}`;
};
