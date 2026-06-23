/**
 * Airdrop devnet SOL to the worker's configured signer.
 *
 *   node scripts/fund-signer.cjs [amountSOL]
 *
 * Reads SOLANA_SIGNER_SECRET_KEY (+ SOLANA_RPC_URL) from apps/worker/.env,
 * derives the public key, and requests an airdrop. The public devnet faucet is
 * rate-limited per IP; if this 429s, use `solana airdrop` or https://faucet.solana.com.
 */
const fs = require('fs');
const path = require('path');
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

(async () => {
  const env = readEnv(path.join(__dirname, '..', 'apps', 'worker', '.env'));
  const raw = (env.SOLANA_SIGNER_SECRET_KEY || '').trim();
  if (!raw) throw new Error('SOLANA_SIGNER_SECRET_KEY is empty in apps/worker/.env');

  const bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw);
  const kp = Keypair.fromSecretKey(bytes);
  const pubkey = new PublicKey(kp.publicKey);
  const amount = Number(process.argv[2] || 2);

  const conn = new Connection(env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
  console.log(`Signer: ${pubkey.toBase58()}`);
  console.log(`Current balance: ${(await conn.getBalance(pubkey)) / LAMPORTS_PER_SOL} SOL`);
  console.log(`Requesting airdrop of ${amount} SOL…`);

  const sig = await conn.requestAirdrop(pubkey, amount * LAMPORTS_PER_SOL);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
  console.log(`Done. New balance: ${(await conn.getBalance(pubkey)) / LAMPORTS_PER_SOL} SOL`);
})().catch((e) => {
  console.error('Airdrop failed:', e.message);
  console.error('Tip: run `solana airdrop 2 <pubkey> --url devnet` or use https://faucet.solana.com');
  process.exit(1);
});
