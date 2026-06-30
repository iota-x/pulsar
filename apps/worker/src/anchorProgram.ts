import { createHash } from 'crypto';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { connection, getSigner, explorerUrl } from './solana';

/** Deployed web3_zapier program (devnet). Override via WEB3_ZAPIER_PROGRAM_ID. */
export const PROGRAM_ID = new PublicKey(
  process.env.WEB3_ZAPIER_PROGRAM_ID ?? '3UDvaK5Xxa7JsGUF3peRzbgspk5ASUQxCQEfhibj7Rjs',
);

/**
 * Treasury wallet that collects the platform fee skimmed inside the program's
 * execute_delegated_transfer. Must match the on-chain TREASURY constant — the
 * program rejects any other fee destination. Defaults to the operator wallet.
 */
export const TREASURY = new PublicKey(process.env.TREASURY_PUBKEY ?? 'FgCiArPJfe9YCfW8Gioo87uoG7M9zXiPg8JvJHK3uTtJ');

/** Platform fee in basis points — MUST match the on-chain FEE_BPS constant. */
export const FEE_BPS = 50;

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

/** Borsh-encode a bool as a single byte. */
function borshBool(value: boolean): Buffer {
  return Buffer.from([value ? 1 : 0]);
}

/** Little-endian u64. */
function u64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
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

/**
 * Execute a non-custodial delegated token transfer: moves `amountRaw` (base
 * units) of `mint` from the delegating user's wallet to `recipient`, signed by
 * the program's authority PDA. The user authorized this once via create_delegation
 * + SPL approve; we never hold their key. Reverts on-chain if it exceeds the cap
 * or the delegation expired.
 */
/** Build the `execute_delegated_transfer` instruction (for composition). */
export function buildDelegatedTransferIx(
  owner: PublicKey,
  mint: PublicKey,
  source: PublicKey,
  destination: PublicKey,
  feeDestination: PublicKey,
  amountRaw: bigint,
): TransactionInstruction {
  const signer = requireSigner();
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from('authority')], PROGRAM_ID);
  const [delegation] = PublicKey.findProgramAddressSync(
    [Buffer.from('delegation'), owner.toBuffer(), mint.toBuffer()],
    PROGRAM_ID,
  );
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    // Account order must match the ExecuteDelegatedTransfer struct: the treasury
    // fee_destination sits right after destination.
    keys: [
      { pubkey: delegation, isSigner: false, isWritable: true },
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: feeDestination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: signer.publicKey, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('execute_delegated_transfer'), u64(amountRaw)]),
  });
}

export async function callDelegatedTransfer(
  owner: PublicKey,
  mint: PublicKey,
  recipient: PublicKey,
  amountRaw: bigint,
): Promise<string> {
  const signer = requireSigner();
  const source = await getAssociatedTokenAddress(mint, owner);
  const dest = await getOrCreateAssociatedTokenAccount(connection, signer, mint, recipient);
  // The treasury's ATA for this mint must exist to receive the platform fee.
  const feeDest = await getOrCreateAssociatedTokenAccount(connection, signer, mint, TREASURY);
  const ix = buildDelegatedTransferIx(owner, mint, source, dest.address, feeDest.address, amountRaw);
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [signer]);
  return explorerUrl(sig);
}

/**
 * Run a full governance cycle for a uniquely-id'd proposal: create_proposal →
 * cast_vote(approve) → execute_proposal. Returns the proposal PDA and the
 * explorer URL of the execution transaction.
 */
export async function callGovernanceCycle(
  id: string,
  description: string,
): Promise<{ proposal: string; executeUrl: string }> {
  const signer = requireSigner();
  const seedId = id.slice(0, 32);

  const [proposal] = PublicKey.findProgramAddressSync(
    [Buffer.from('proposal'), signer.publicKey.toBuffer(), Buffer.from(seedId, 'utf8')],
    PROGRAM_ID,
  );

  // 1. create_proposal(id, description)
  const createIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('create_proposal'), borshString(seedId), borshString(description)]),
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(createIx), [signer]);

  // 2. cast_vote(true)
  const voteIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([discriminator('cast_vote'), borshBool(true)]),
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(voteIx), [signer]);

  // 3. execute_proposal()
  const execIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: false },
    ],
    data: discriminator('execute_proposal'),
  });
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(execIx), [signer]);

  return { proposal: proposal.toBase58(), executeUrl: explorerUrl(sig) };
}
