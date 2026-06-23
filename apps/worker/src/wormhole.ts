import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
// Import only the Solana submodule — the package root pulls broken Cosmos deps.
import * as wh from '@certusone/wormhole-sdk/lib/cjs/solana/wormhole';
import { connection, getSigner, explorerUrl } from './solana';

/** Wormhole Core Bridge (Solana devnet/testnet). Override via WORMHOLE_CORE_BRIDGE. */
const CORE = new PublicKey(
  process.env.WORMHOLE_CORE_BRIDGE ?? '3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5',
);

const u32le = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
};

/**
 * Publish a message through the Wormhole Core Bridge. The guardians observe it
 * and produce a signed VAA that can be redeemed on the destination chain.
 * Returns the transaction's explorer URL.
 */
export async function postCrossChainMessage(payload: Buffer): Promise<string> {
  const signer = getSigner();
  if (!signer) throw new Error('no signer configured (set SOLANA_SIGNER_SECRET_KEY)');

  const message = Keypair.generate();
  const emitter = signer; // legacy keypair emitter
  const bridge = wh.deriveWormholeBridgeDataKey(CORE);
  const feeCollector = wh.deriveFeeCollectorKey(CORE);
  const sequence = wh.deriveEmitterSequenceKey(emitter.publicKey, CORE);

  // PostMessage data: variant(1) + nonce(u32) + payload(vec) + consistency(u8=Confirmed).
  const nonce = Math.floor(Math.random() * 0xffffffff);
  const data = Buffer.concat([
    Buffer.from([1]),
    u32le(nonce),
    Buffer.concat([u32le(payload.length), payload]),
    Buffer.from([1]),
  ]);

  const keys = [
    { pubkey: bridge, isSigner: false, isWritable: true },
    { pubkey: message.publicKey, isSigner: true, isWritable: true },
    { pubkey: emitter.publicKey, isSigner: true, isWritable: false },
    { pubkey: sequence, isSigner: false, isWritable: true },
    { pubkey: signer.publicKey, isSigner: true, isWritable: true },
    { pubkey: feeCollector, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const tx = new Transaction();
  tx.add(await wh.createBridgeFeeTransferInstruction(connection, CORE, signer.publicKey));
  tx.add(new TransactionInstruction({ programId: CORE, keys, data }));

  const sig = await sendAndConfirmTransaction(connection, tx, [signer, message, emitter]);
  return explorerUrl(sig);
}
