-- Execution history + idempotency ledger.
ALTER TABLE "Log" ADD COLUMN "triggerType" TEXT;
ALTER TABLE "Log" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "Log" ADD COLUMN "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Log" ADD COLUMN "finishedAt" TIMESTAMP(3);

-- Exactly-once: a claimed dedupeKey that already exists means "already ran".
CREATE UNIQUE INDEX "Log_dedupeKey_key" ON "Log"("dedupeKey");
CREATE INDEX "Log_status_idx" ON "Log"("status");
