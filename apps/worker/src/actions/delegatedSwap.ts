import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from '@solana/web3.js';
import {
  getMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import { connection, getSigner, explorerUrl, toPublicKey } from '../solana';
import { buildDelegatedTransferIx, TREASURY, FEE_BPS } from '../anchorProgram';
import type { ActionConfig } from '@web3-zapier/shared';

const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const JUPITER_API = process.env.JUPITER_API_URL ?? 'https://api.jup.ag/swap/v1';

interface JupIx {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}
const deserIx = (ix: JupIx): TransactionInstruction =>
  new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, 'base64'),
  });

/**
 * Non-custodial DELEGATED swap (mainnet). In ONE atomic transaction the operator:
 *   1. pulls the user's delegated input token into the operator's account (capped),
 *   2. swaps it via Jupiter,
 *   3. sends the output straight to the recipient.
 * If any step fails the whole tx reverts, so the operator never custodies funds
 * beyond the atomic boundary.
 *
 *   side 'sell' → input = the user's token (delegated), output = wSOL
 *   side 'buy'  → input = wSOL (delegated), output = the token
 *
 * NOTE: Jupiter routes mainnet liquidity only — on devnet the quote returns "no
 * route", so this is a mainnet feature. The user's swap-delegation should leave
 * the recipient allowlist empty (or include the operator), since the pull's
 * destination is the operator's intermediate account.
 */
export async function executeDelegatedSwap(config: ActionConfig): Promise<string> {
  const signer = getSigner();
  if (!signer) throw new Error('execute_buy_sell_order: no signer configured');
  if (!config.owner) throw new Error('delegated swap requires a linked wallet owner');
  if (!config.mint) throw new Error('execute_buy_sell_order: "mint" is required');
  const amount = Number(config.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('valid "amount" is required');

  const owner = toPublicKey(config.owner, 'owner');
  const token = toPublicKey(config.mint, 'mint');
  const side = (config.side as string) || 'buy';
  const slippageBps = Number(config.slippageBps ?? 50);

  const inputMint = side === 'sell' ? token : WSOL;
  const outputMint = side === 'sell' ? WSOL : token;
  const inputDecimals = inputMint.equals(WSOL) ? 9 : (await getMint(connection, inputMint)).decimals;
  const amountRaw = BigInt(Math.round(amount * 10 ** inputDecimals));
  // The program skims FEE_BPS during the pull, so the operator only receives the
  // NET input to swap. Mirror that here: quote/swap on net, but pull the gross
  // (net → operator, fee → treasury) — the user's cap consumes the gross amount.
  const feeRaw = (amountRaw * BigInt(FEE_BPS)) / 10_000n;
  const netRaw = amountRaw - feeRaw;

  const recipient = config.to ? toPublicKey(config.to, 'recipient') : owner;
  const operatorInputAta = await getAssociatedTokenAddress(inputMint, signer.publicKey);
  const userInputAta = await getAssociatedTokenAddress(inputMint, owner);
  const treasuryInputAta = await getAssociatedTokenAddress(inputMint, TREASURY);
  const recipientOutputAta = await getAssociatedTokenAddress(outputMint, recipient);

  // 1. Quote — on the NET amount the operator will actually hold post-fee.
  const quote = await fetch(
    `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${netRaw}&slippageBps=${slippageBps}`,
  ).then((r) => r.json());
  if (quote.error || !quote.outAmount) throw new Error(`No swap route: ${quote.error ?? 'Jupiter returned no route'}`);

  // 2. Swap instructions — output delivered straight to the recipient.
  const swapRes = await fetch(`${JUPITER_API}/swap-instructions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: signer.publicKey.toBase58(),
      destinationTokenAccount: recipientOutputAta.toBase58(),
      wrapAndUnwrapSol: false,
    }),
  }).then((r) => r.json());
  if (swapRes.error) throw new Error(`Jupiter swap-instructions: ${swapRes.error}`);

  const computeBudget: TransactionInstruction[] = (swapRes.computeBudgetInstructions ?? []).map(deserIx);
  const setup: TransactionInstruction[] = (swapRes.setupInstructions ?? []).map(deserIx);
  const swapIx = deserIx(swapRes.swapInstruction);
  const cleanup: TransactionInstruction[] = swapRes.cleanupInstruction ? [deserIx(swapRes.cleanupInstruction)] : [];

  // Ensure the operator's input ATA, the treasury's input ATA (fee), and the
  // recipient's output ATA all exist, then pull the gross from the user.
  const ensure = [
    createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, operatorInputAta, signer.publicKey, inputMint),
    createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, treasuryInputAta, TREASURY, inputMint),
    createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, recipientOutputAta, recipient, outputMint),
  ];
  const pullIx = buildDelegatedTransferIx(owner, inputMint, userInputAta, operatorInputAta, treasuryInputAta, amountRaw);

  // 3. Compose + send one atomic versioned transaction.
  const instructions = [...computeBudget, ...ensure, pullIx, ...setup, swapIx, ...cleanup];
  const altAddrs: string[] = swapRes.addressLookupTableAddresses ?? [];
  const alts = (
    await Promise.all(altAddrs.map((a) => connection.getAddressLookupTable(new PublicKey(a)).then((r) => r.value)))
  ).filter((x): x is AddressLookupTableAccount => !!x);

  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message(alts);
  const vtx = new VersionedTransaction(msg);
  vtx.sign([signer]);
  const sig = await connection.sendRawTransaction(vtx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');

  const outDecimals = outputMint.equals(WSOL) ? 9 : (await getMint(connection, outputMint)).decimals;
  const outUi = Number(quote.outAmount) / 10 ** outDecimals;
  return `Delegated ${side}: ${amount} ${side === 'sell' ? 'token' : 'SOL'} → ~${outUi.toFixed(4)} ${side === 'sell' ? 'wSOL' : 'token'} for ${config.owner} — ${explorerUrl(sig)}`;
}
