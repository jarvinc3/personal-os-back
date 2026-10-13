-- Retention and operation grouping for the deletion journal. `expires_at` is
-- added nullable, backfilled from `deleted_at`, then made required.

ALTER TABLE "fin_deletion_journal"
  ADD COLUMN IF NOT EXISTS "operation_group_id" TEXT,
  ADD COLUMN IF NOT EXISTS "size_bytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ(6);

UPDATE "fin_deletion_journal"
SET "expires_at" = "deleted_at" + INTERVAL '30 days'
WHERE "expires_at" IS NULL;

ALTER TABLE "fin_deletion_journal"
  ALTER COLUMN "expires_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "fin_deletion_journal_expires_at_idx"
  ON "fin_deletion_journal"("expires_at");
