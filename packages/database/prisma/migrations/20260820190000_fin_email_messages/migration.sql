-- Persist per-message Gmail extraction outcomes (skip non-tx / non-retryable failures)

DO $$ BEGIN
  CREATE TYPE "FinEmailMessageOutcome" AS ENUM (
    'IMPORTED',
    'SKIPPED_NOT_TX',
    'FAILED_NON_RETRYABLE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "fin_email_messages" (
  "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
  "source_id" TEXT NOT NULL,
  "gmail_message_id" TEXT NOT NULL,
  "outcome" "FinEmailMessageOutcome" NOT NULL,
  "reason" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fin_email_messages_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_email_messages_source_id_fkey'
  ) THEN
    ALTER TABLE "fin_email_messages"
      ADD CONSTRAINT "fin_email_messages_source_id_fkey"
      FOREIGN KEY ("source_id") REFERENCES "fin_email_sources"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "fin_email_messages_source_gmail_key"
  ON "fin_email_messages"("source_id", "gmail_message_id");

CREATE INDEX IF NOT EXISTS "fin_email_messages_source_id_idx"
  ON "fin_email_messages"("source_id");

ALTER TABLE "fin_email_messages" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fin_email_messages_all_own" ON "fin_email_messages";
CREATE POLICY "fin_email_messages_all_own" ON "fin_email_messages"
  FOR ALL TO authenticated
  USING (
    source_id IN (
      SELECT s.id FROM fin_email_sources s
      WHERE s.user_id = (SELECT auth.uid())::text
    )
  )
  WITH CHECK (
    source_id IN (
      SELECT s.id FROM fin_email_sources s
      WHERE s.user_id = (SELECT auth.uid())::text
    )
  );
