-- Add the verified wallet address used for delegated (non-custodial) actions.
ALTER TABLE "User" ADD COLUMN "walletAddress" TEXT;
