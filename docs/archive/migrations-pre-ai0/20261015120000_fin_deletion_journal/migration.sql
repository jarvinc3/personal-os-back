-- Snapshot of a finance record removed from the detail menu, so "Deshacer" can
-- re-create the rows and re-apply the ledger deltas that the delete reversed.

CREATE TABLE IF NOT EXISTS "fin_deletion_journal" (
  "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "deleted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "restored_at" TIMESTAMPTZ(6),
  CONSTRAINT "fin_deletion_journal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fin_deletion_journal_user_entity_idx"
  ON "fin_deletion_journal"("user_id", "entity_type", "entity_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_deletion_journal_user_id_fkey'
  ) THEN
    ALTER TABLE "fin_deletion_journal"
      ADD CONSTRAINT "fin_deletion_journal_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
