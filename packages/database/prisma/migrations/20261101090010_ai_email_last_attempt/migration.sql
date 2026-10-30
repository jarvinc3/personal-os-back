-- Creada el 2026-10-30; el timestamp sigue la última migración existente.
CREATE TYPE "ai_email_sync_attempt_result" AS ENUM ('SUCCEEDED', 'FAILED', 'INTERRUPTED');

ALTER TABLE "ai_email_connections"
  ADD COLUMN "last_attempt_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_attempt_finished_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_attempt_result" "ai_email_sync_attempt_result",
  ADD COLUMN "last_attempt_error_code" TEXT,
  ADD COLUMN "last_attempt_error_category" TEXT,
  ADD COLUMN "last_attempt_imported_count" INTEGER,
  ADD COLUMN "last_attempt_phase" TEXT,
  ADD COLUMN "last_failure_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_failure_error_code" TEXT,
  ADD COLUMN "last_failure_error_category" TEXT,
  ADD COLUMN "last_failure_imported_count" INTEGER,
  ADD COLUMN "last_failure_phase" TEXT;
