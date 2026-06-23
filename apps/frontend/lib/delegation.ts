import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createApproveInstruction,
  createRevokeInstruction,
  getMint,
} from '@solana/spl-token';

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? '3UDvaK5Xxa7JsGUF3peRzbgspk5ASUQxCQEfhibj7Rjs',
);
/** The worker's public key — recorded as the authorized operator in delegations. */
export const OPERATOR = new PublicKey(
  process.env.NEXT_PUBLIC_OPERATOR_PUBKEY ?? 'FgCiArPJfe9YCfW8Gioo87uoG7M9zXiPg8JvJHK3uTtJ',
);

// Anchor discriminators (sha256("global:<name>")[..8]).
const CREATE_DELEGATION_DISC = Uint8Array.from([177, 165, 93, 55, 227, 163, 61, 175]);
const REVOKE_DELEGATION_DISC = Uint8Array.from([188, 92, 135, 67, 160, 181, 54, 62]);

const u64 = (n: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const i64 = (n: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(n);
  return b;
};

export const authorityPda = (): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from('authority')], PROGRAM_ID)[0];

export const delegationPda = (owner: PublicKey, mint: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('delegation'), owner.toBuffer(), mint.toBuffer()],
    PROGRAM_ID,
  )[0];

/**
 * Build the one-time transaction the user signs to authorize automation:
 * SPL `approve` (token account → authority PDA) + `create_delegation` with the
 * cap, expiry, operator, and an optional recipient allowlist (empty = any).
 */
export async function buildDelegationTx(
  connection: Connection,
  owner: PublicKey,
  mintStr: string,
  maxUi: number,
  expiryUnix: number,
  recipients: string[] = [],
): Promise<Transaction> {
  const mint = new PublicKey(mintStr);
  const decimals = (await getMint(connection, mint)).decimals;
  const maxRaw = BigInt(Math.round(maxUi * 10 ** decimals));
  const userAta = await getAssociatedTokenAddress(mint, owner);

  // Borsh Vec<Pubkey>: u32 LE length + 32 bytes each.
  const recipientKeys = recipients.map((r) => new PublicKey(r.trim()));
  const recLen = Buffer.alloc(4);
  recLen.writeUInt32LE(recipientKeys.length, 0);
  const recBytes = Buffer.concat([recLen, ...recipientKeys.map((k) => k.toBuffer())]);

  const approveIx = createApproveInstruction(userAta, authorityPda(), owner, maxRaw);
  const createIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: delegationPda(owner, mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from(CREATE_DELEGATION_DISC),
      u64(maxRaw),
      i64(BigInt(Math.trunc(expiryUnix))),
      OPERATOR.toBuffer(),
      recBytes,
    ]),
  });

  return new Transaction().add(approveIx).add(createIx);
}

export interface DelegationInfo {
  pubkey: string;
  mint: string;
  maxAmount: bigint;
  usedAmount: bigint;
  expiry: number;
  recipients: string[];
}

/** Fetch all delegations owned by `owner` (memcmp on the owner field). */
export async function fetchDelegations(connection: Connection, owner: PublicKey): Promise<DelegationInfo[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 8, bytes: owner.toBase58() } }], // owner is at offset 8 (after disc)
  });

  const out: DelegationInfo[] = [];
  for (const { pubkey, account } of accounts) {
    const d = account.data;
    // disc(8) owner(32) mint(32) operator(32) max(8) used(8) expiry(8) recipientsVec bump
    if (d.length < 128) continue;
    const mint = new PublicKey(d.subarray(40, 72)).toBase58();
    const maxAmount = d.readBigUInt64LE(104);
    const usedAmount = d.readBigUInt64LE(112);
    const expiry = Number(d.readBigInt64LE(120));
    const recLen = d.readUInt32LE(128);
    const recipients: string[] = [];
    for (let i = 0; i < recLen; i++) {
      const start = 132 + i * 32;
      recipients.push(new PublicKey(d.subarray(start, start + 32)).toBase58());
    }
    out.push({ pubkey: pubkey.toBase58(), mint, maxAmount, usedAmount, expiry, recipients });
  }
  return out;
}

/** Build a transaction that revokes a delegation: close the PDA + SPL revoke. */
export async function buildRevokeTx(owner: PublicKey, mintStr: string): Promise<Transaction> {
  const mint = new PublicKey(mintStr);
  const userAta = await getAssociatedTokenAddress(mint, owner);
  const revokeProgramIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: delegationPda(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
    ],
    data: Buffer.from(REVOKE_DELEGATION_DISC),
  });
  return new Transaction().add(createRevokeInstruction(userAta, owner)).add(revokeProgramIx);
}
