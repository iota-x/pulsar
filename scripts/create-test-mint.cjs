/**
 * Create a test SPL mint owned by the worker's signer, for trying out the
 * on-chain actions (mint_tokens / burn_tokens / transfer_nft).
 *
 *   node scripts/create-test-mint.cjs [decimals]
 *
 *   decimals 6  → a normal fungible token (default)
 *   decimals 0  → an NFT-style token (use with transfer_nft after minting 1)
 *
 * The signer must already hold some devnet SOL (`npm run fund:signer`).
 * Prints the new mint address — paste it into the action's `mint` field.
 */
const fs = require('fs');
const path = require('path');
const { Connection, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { createMint } = require('@solana/spl-token');
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
  const signer = Keypair.fromSecretKey(bytes);
  const decimals = Number(process.argv[2] ?? 6);

  const conn = new Connection(env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
  const balance = (await conn.getBalance(signer.publicKey)) / LAMPORTS_PER_SOL;
  console.log(`Signer: ${signer.publicKey.toBase58()} (balance ${balance} SOL)`);
  if (balance === 0) throw new Error('Signer has 0 SOL — run `npm run fund:signer` first');

  console.log(`Creating mint with ${decimals} decimals…`);
  const mint = await createMint(conn, signer, signer.publicKey, signer.publicKey, decimals);
  console.log(`\n✅ Mint created: ${mint.toBase58()}`);
  console.log(`   Use it in a mint_tokens action (to: ${signer.publicKey.toBase58()}, amount: 100).`);
})().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
