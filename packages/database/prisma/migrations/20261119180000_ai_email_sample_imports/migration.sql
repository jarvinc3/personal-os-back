-- CreateEnum
CREATE TYPE "ai_email_sample_import_status" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ai_email_sample_import_selection" AS ENUM ('IDS', 'SENDER_WINDOW');

-- CreateTable
CREATE TABLE "ai_email_sample_imports" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "dry_run" BOOLEAN NOT NULL,
  "status" "ai_email_sample_import_status" NOT NULL DEFAULT 'QUEUED',
  "selection_mode" "ai_email_sample_import_selection" NOT NULL,
  "message_ids" TEXT[] NOT NULL,
  "sender" TEXT,
  "date_from" TIMESTAMPTZ(6),
  "date_to" TIMESTAMPTZ(6),
  "total" INTEGER NOT NULL DEFAULT 0,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "result" JSONB,
  "error" TEXT,
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_email_sample_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_email_sample_imports_user_created_idx" ON "ai_email_sample_imports"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_email_sample_imports_user_status_idx" ON "ai_email_sample_imports"("user_id", "status");

-- AddForeignKey
ALTER TABLE "ai_email_sample_imports"
  ADD CONSTRAINT "ai_email_sample_imports_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
