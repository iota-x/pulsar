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

// Anchor discriminator for `create_delegation` (sha256("global:create_delegation")[..8]).
const CREATE_DELEGATION_DISC = Uint8Array.from([177, 165, 93, 55, 227, 163, 61, 175]);

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
 * an SPL `approve` (their token account → our authority PDA) + `create_delegation`
 * recording the cap + expiry + operator. `maxUi` is in UI units; `expiryUnix` 0 = none.
 */
export async function buildDelegationTx(
  connection: Connection,
  owner: PublicKey,
  mintStr: string,
  maxUi: number,
  expiryUnix: number,
): Promise<Transaction> {
  const mint = new PublicKey(mintStr);
  const decimals = (await getMint(connection, mint)).decimals;
  const maxRaw = BigInt(Math.round(maxUi * 10 ** decimals));
  const userAta = await getAssociatedTokenAddress(mint, owner);

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
    ]),
  });

  return new Transaction().add(approveIx).add(createIx);
}

/** Build a transaction that revokes the SPL approval (cancels the delegation). */
export async function buildRevokeTx(
  owner: PublicKey,
  mintStr: string,
  connection: Connection,
): Promise<Transaction> {
  const userAta = await getAssociatedTokenAddress(new PublicKey(mintStr), owner);
  void connection;
  return new Transaction().add(createRevokeInstruction(userAta, owner));
}
