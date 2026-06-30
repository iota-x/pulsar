import { PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import {
  Raydium,
  TxVersion,
  DEVNET_PROGRAM_ID,
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
  getCpmmPdaAmmConfigId,
} from '@raydium-io/raydium-sdk-v2';
import type { ActionHandler } from './types';
import { connection, getSigner, explorerUrl, toPublicKey, RPC_URL } from '../solana';

const WSOL = 'So11111111111111111111111111111111111111112';

/**
 * Create a Raydium CPMM (constant-product) liquidity pool from two SPL tokens.
 * `tokenB` defaults to wrapped SOL. Seeds the pool with `amountA`/`amountB`
 * (UI units). Returns the new pool id + the creation transaction link.
 *
 * Uses Raydium's devnet CPMM program; on mainnet point SOLANA_RPC_URL at mainnet
 * and the SDK will use the mainnet program automatically.
 */
export const createLiquidityPool: ActionHandler = async (config) => {
  const signer = getSigner();
  if (!signer) throw new Error('create_liquidity_pool: no signer configured (set SOLANA_SIGNER_SECRET_KEY)');
  if (!config.tokenA) throw new Error('create_liquidity_pool: "tokenA" is required');

  const isDevnet = RPC_URL.includes('devnet');
  const tokenAMint = toPublicKey(config.tokenA, 'tokenA');
  const tokenBMint = toPublicKey((config.tokenB as string) || WSOL, 'tokenB');

  const decA = (await getMint(connection, tokenAMint)).decimals;
  const decB = tokenBMint.toBase58() === WSOL ? 9 : (await getMint(connection, tokenBMint)).decimals;

  const amountA = Number(config.amountA ?? config.amount ?? 0);
  const amountB = Number(config.amountB ?? 0);
  if (amountA <= 0 || amountB <= 0) throw new Error('create_liquidity_pool: "amountA" and "amountB" are required');

  // CPMM requires token0 < token1 ordering by pubkey.
  let mintA = { address: tokenAMint.toBase58(), decimals: decA, programId: TOKEN_PROGRAM_ID.toBase58() };
  let mintB = { address: tokenBMint.toBase58(), decimals: decB, programId: TOKEN_PROGRAM_ID.toBase58() };
  let amtA = new BN(Math.round(amountA * 10 ** decA).toString());
  let amtB = new BN(Math.round(amountB * 10 ** decB).toString());
  if (tokenAMint.toBuffer().compare(tokenBMint.toBuffer()) > 0) {
    [mintA, mintB] = [mintB, mintA];
    [amtA, amtB] = [amtB, amtA];
  }

  const raydium = await Raydium.load({
    connection,
    owner: signer,
    cluster: isDevnet ? 'devnet' : 'mainnet',
  });

  const programId = isDevnet ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM : CREATE_CPMM_POOL_PROGRAM;
  const poolFeeAccount = isDevnet ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC : CREATE_CPMM_POOL_FEE_ACC;

  const feeConfigs = await raydium.api.getCpmmConfigs();
  if (isDevnet) {
    feeConfigs.forEach((c) => {
      c.id = getCpmmPdaAmmConfigId(programId, c.index).publicKey.toBase58();
    });
  }

  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId,
    poolFeeAccount,
    // The SDK's ApiV3Token type carries extra display fields we don't need here.
    mintA: mintA as never,
    mintB: mintB as never,
    mintAAmount: amtA,
    mintBAmount: amtB,
    startTime: new BN(0),
    feeConfig: feeConfigs[0],
    associatedOnly: false,
    ownerInfo: { useSOLBalance: true },
    txVersion: TxVersion.V0,
  });

  const poolId = extInfo.address.poolId.toBase58();
  const { txId } = await execute({ sendAndConfirm: true });
  return `Created Raydium pool ${poolId} — ${explorerUrl(txId)}`;
};
