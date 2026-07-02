-- Per-workflow Solana network. Existing workflows default to "devnet"
-- (the live cluster today); "mainnet-beta" enables off-chain-only automations.
ALTER TABLE "Workflow" ADD COLUMN "network" TEXT NOT NULL DEFAULT 'devnet';
