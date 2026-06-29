/**
 * End-to-end devnet verification of the NON-CUSTODIAL delegated-transfer path —
 * the foundation of Phase 2. It exercises the REAL worker + frontend code:
 *
 *   1. fund a fresh "user" wallet from the operator
 *   2. mint a test SPL token to the user (operator is mint authority)
 *   3. the USER authorizes a capped, allowlisted delegation (buildDelegationTx)
 *   4. the OPERATOR moves the user's token via callDelegatedTransfer  ← executor path
 *   5. assert the recipient received it and the on-chain cap incremented
 *   6. assert an OVER-CAP transfer reverts on-chain (the security guarantee)
 *
 *   npx tsx scripts/verify-delegation.ts
 *
 * Needs the operator (SOLANA_SIGNER_SECRET_KEY in apps/worker/.env) funded with
 * a little devnet SOL (`npm run fund:signer`).
 */
import fs from 'fs';
import path from 'path';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

/**
 * Read a single delegation PDA's cap/usage via getAccountInfo. (fetchDelegations
 * in the app uses getProgramAccounts, which Alchemy's free tier blocks — but a
 * direct single-account read is always allowed.) Offsets mirror the on-chain
 * layout: disc(8) owner(32) mint(32) operator(32) max@104 used@112 ... recLen@152.
 */
async function readDelegation(conn: Connection, pda: PublicKey) {
  const info = await conn.getAccountInfo(pda);
  if (!info) return null;
  const d = info.data;
  return {
    maxAmount: d.readBigUInt64LE(104),
    usedAmount: d.readBigUInt64LE(112),
    recipients: d.readUInt32LE(152),
  };
}
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import bs58 from 'bs58';

// --- env (manual parse; dotenv isn't hoisted to the repo root) ---------------
function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = readEnv(path.join(__dirname, '..', 'apps', 'worker', '.env'));
// Expose to process.env so the worker's solana.ts / anchorProgram pick them up.
for (const k of ['SOLANA_RPC_URL', 'SOLANA_WS_URL', 'SOLANA_SIGNER_SECRET_KEY', 'WEB3_ZAPIER_PROGRAM_ID']) {
  if (env[k]) process.env[k] = env[k];
}
// Only set when defined — assigning undefined coerces to the string "undefined",
// which then defeats the `?? default` fallback in the frontend module.
const progId = env.WEB3_ZAPIER_PROGRAM_ID ?? env.NEXT_PUBLIC_PROGRAM_ID;
if (progId) process.env.NEXT_PUBLIC_PROGRAM_ID = progId;
if (env.NEXT_PUBLIC_OPERATOR_PUBKEY) process.env.NEXT_PUBLIC_OPERATOR_PUBKEY = env.NEXT_PUBLIC_OPERATOR_PUBKEY;

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);

(async () => {
  // Import the REAL builders only after env is set (they read it at module load).
  const { callDelegatedTransfer, TREASURY } = await import('../apps/worker/src/anchorProgram');
  const { buildDelegationTx, delegationPda } = await import('../apps/frontend/lib/delegation');
  // Reuse the worker's connection — it pins the public-devnet ws endpoint that
  // supports signatureSubscribe (the Alchemy ws does not), so confirmations work.
  const { connection: conn } = await import('../apps/worker/src/solana');

  const raw = env.SOLANA_SIGNER_SECRET_KEY.trim();
  const operator = Keypair.fromSecretKey(raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw));
  const user = Keypair.generate(); // the delegator
  const recipient = Keypair.generate().publicKey; // allowlisted destination

  console.log('operator :', operator.publicKey.toBase58());
  console.log('user     :', user.publicKey.toBase58());
  console.log('recipient:', recipient.toBase58());

  // 1. Fund the user (pays its delegation-PDA rent + a couple of fees).
  step('Funding the user wallet from the operator');
  {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: user.publicKey, lamports: 12_000_000 }),
    );
    await sendAndConfirmTransaction(conn, tx, [operator]);
    ok('sent 0.012 SOL to user');
  }

  // 2. Mint a test SPL token to the user (operator = mint authority, 6 decimals).
  step('Creating a test SPL token and minting 100 to the user');
  const mint = await createMint(conn, operator, operator.publicKey, null, 6);
  const userAta = await getOrCreateAssociatedTokenAccount(conn, operator, mint, user.publicKey);
  await mintTo(conn, operator, mint, userAta.address, operator, 100_000_000n); // 100.000000
  ok(`mint ${mint.toBase58()} — user balance 100`);

  // 3. USER authorizes a capped (50), allowlisted delegation — one signature.
  step('User authorizes a delegation (cap 50, recipient allowlisted)');
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const delTx = await buildDelegationTx(conn, user.publicKey, mint.toBase58(), 50, expiry, [recipient.toBase58()]);
  delTx.feePayer = user.publicKey;
  await sendAndConfirmTransaction(conn, delTx, [user]);
  const delPda = delegationPda(user.publicKey, mint);
  const d0 = await readDelegation(conn, delPda);
  if (!d0) throw new Error('delegation account not found after create');
  ok(`delegation live — max=${Number(d0.maxAmount) / 1e6}, used=${Number(d0.usedAmount) / 1e6}, recipients=${d0.recipients}`);

  // 4. OPERATOR moves 10 of the user's token to the recipient — the executor path.
  //    Signature: callDelegatedTransfer(owner, mint, recipient, amountRaw).
  step('Operator runs callDelegatedTransfer(user → recipient, 10)  [executor path]');
  const explorer = await callDelegatedTransfer(user.publicKey, mint, recipient, 10_000_000n);
  ok(`transfer confirmed — ${explorer}`);

  // 5. Assert the fee split: recipient gets net (9.95), treasury gets the fee
  //    (0.05 = 0.5% of 10), the user is debited the full gross (10), and the
  //    on-chain cap counts the gross.
  step('Verifying the fee split, balances, and on-chain cap accounting');
  const recAta = await getAssociatedTokenAddress(mint, recipient);
  const treasuryAta = await getAssociatedTokenAddress(mint, TREASURY);
  const recBal = (await getAccount(conn, recAta)).amount;
  const treBal = (await getAccount(conn, treasuryAta)).amount;
  const userBal = (await getAccount(conn, userAta.address)).amount;
  const d1 = (await readDelegation(conn, delPda))!;
  console.log(`  recipient balance: ${Number(recBal) / 1e6} (expected 9.95 = net)`);
  console.log(`  treasury fee     : ${Number(treBal) / 1e6} (expected 0.05 = 0.5%)`);
  console.log(`  user balance     : ${Number(userBal) / 1e6} (expected 90 = gross debited)`);
  console.log(`  delegation used  : ${Number(d1.usedAmount) / 1e6} (expected 10 = gross)`);
  if (recBal !== 9_950_000n) throw new Error('recipient did not receive the net (9.95)');
  if (treBal !== 50_000n) throw new Error('treasury did not receive the 0.5% fee');
  if (userBal !== 90_000_000n) throw new Error('user balance not debited the gross');
  if (d1.usedAmount !== 10_000_000n) throw new Error('on-chain cap usage not the gross');
  ok('non-custodial transfer + platform fee verified — recipient net, treasury cut, cap on gross');

  // 6. Security guarantee: an over-cap transfer (45 > remaining 40) must revert.
  step('Verifying the cap is enforced on-chain (over-cap must revert)');
  let reverted = false;
  try {
    await callDelegatedTransfer(user.publicKey, mint, recipient, 45_000_000n);
  } catch {
    reverted = true;
  }
  if (!reverted) throw new Error('SECURITY: over-cap transfer did NOT revert');
  ok('over-cap transfer correctly reverted — the user cap holds');

  console.log('\n✅ PASS — non-custodial delegation works end-to-end on devnet.');
})().catch((e) => {
  console.error('\n❌ FAIL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
