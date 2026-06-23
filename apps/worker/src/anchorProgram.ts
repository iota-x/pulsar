import { createHash } from 'crypto';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { connection, getSigner, explorerUrl } from './solana';

/** Deployed web3_zapier program (devnet). Override via WEB3_ZAPIER_PROGRAM_ID. */
export const PROGRAM_ID = new PublicKey(
  process.env.WEB3_ZAPIER_PROGRAM_ID ?? '3UDvaK5Xxa7JsGUF3peRzbgspk5ASUQxCQEfhibj7Rjs',
);

/** Anchor's 8-byte instruction discriminator: sha256("global:<name>")[..8]. */
function discriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

/** Borsh-encode a String: u32 LE length prefix + UTF-8 bytes. */
function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

function requireSigner() {
  const signer = getSigner();
  if (!signer) throw new Error('no signer configured (set SOLANA_SIGNER_SECRET_KEY)');
  return signer;
}

/**
 * Call `update_data(key, value)` — creates (first time) or updates the signer's
 * data feed PDA for `key`. Returns the explorer URL of the confirmed tx.
 */
export async function callUpdateData(key: string, value: string): Promise<string> {
  const signer = requireSigner();
  if (Buffer.byteLength(key, 'utf8') > 32) throw new Error('key must be <= 32 bytes');

  const [feed] = PublicKey.findProgramAddressSync(
    [Buffer.from('feed'), signer.publicKey.toBuffer(), Buffer.from(key, 'utf8')],
    PROGRAM_ID,
  );

  const data = Buffer.concat([discriminator('update_data'), borshString(key), borshString(value)]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: feed, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [signer]);
  return explorerUrl(sig);
}

/** Call `ping(label)` — emits an on-chain Triggered event. Returns explorer URL. */
export async function callPing(label: string): Promise<string> {
  const signer = requireSigner();
  const data = Buffer.concat([discriminator('ping'), borshString(label)]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: false }],
    data,
  });
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [signer]);
  return explorerUrl(sig);
}
