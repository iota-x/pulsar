import { VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import type { ActionHandler } from './types';
import { connection, getSigner, explorerUrl, toPublicKey } from '../solana';
import { executeDelegatedSwap } from './delegatedSwap';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
// Jupiter's current public swap API. (The legacy quote-api.jup.ag/v6 host was retired.)
const JUPITER_API = process.env.JUPITER_API_URL ?? 'https://api.jup.ag/swap/v1';

/**
 * Place a market buy/sell order for an SPL token by swapping through Jupiter
 * (Solana's swap aggregator).
 *
 *   side: 'buy'  → swap SOL → token (`amount` is SOL spent)
 *   side: 'sell' → swap token → SOL (`amount` is tokens sold)
 *
 * Jupiter routes mainnet liquidity; on devnet there are usually no routes, in
 * which case the quote step returns a real "no route" error.
 */
export const executeBuySellOrder: ActionHandler = async (config) => {
  // Delegated mode: the executor injected the user's own (signature-verified)
  // wallet as `owner`. Pull their delegated token and swap it atomically — the
  // operator never custodies funds. Jupiter has mainnet liquidity only.
  if (config.owner) return executeDelegatedSwap(config);

  const signer = getSigner();
  if (!signer) throw new Error('execute_buy_sell_order: no signer configured (set SOLANA_SIGNER_SECRET_KEY)');
  if (!config.mint) throw new Error('execute_buy_sell_order: "mint" is required');
  const amount = Number(config.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('execute_buy_sell_order: valid "amount" is required');

  const token = toPublicKey(config.mint, 'execute_buy_sell_order mint');
  const side = (config.side as string) || 'buy';
  const slippageBps = Number(config.slippageBps ?? 50);

  // Resolve input/output mints and the raw input amount (in base units).
  let inputMint: string;
  let outputMint: string;
  let rawAmount: bigint;
  if (side === 'buy') {
    inputMint = SOL_MINT;
    outputMint = token.toBase58();
    rawAmount = BigInt(Math.round(amount * LAMPORTS_PER_SOL));
  } else {
    inputMint = token.toBase58();
    outputMint = SOL_MINT;
    const mintInfo = await getMint(connection, token);
    rawAmount = BigInt(Math.round(amount * 10 ** mintInfo.decimals));
  }

  // 1. Quote
  const quoteUrl = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${rawAmount}&slippageBps=${slippageBps}`;
  const quoteRes = await fetch(quoteUrl);
  if (!quoteRes.ok) {
    const body = await quoteRes.text();
    throw new Error(`Jupiter quote failed (${quoteRes.status}): ${body.slice(0, 200)}`);
  }
  const quote = await quoteRes.json();
  if (quote.error || !quote.outAmount) {
    throw new Error(`No swap route: ${quote.error ?? 'Jupiter returned no route'}`);
  }

  // 2. Build the swap transaction
  const swapRes = await fetch(`${JUPITER_API}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: signer.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
    }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap build failed (${swapRes.status})`);
  const { swapTransaction } = await swapRes.json();

  // 3. Sign and send
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([signer]);
  const sig = await connection.sendRawTransaction(tx.serialize());
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

  return `${side === 'buy' ? 'Bought' : 'Sold'} via Jupiter (${amount} ${side === 'buy' ? 'SOL' : 'tokens'}) — ${explorerUrl(sig)}`;
};
