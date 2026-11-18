-- AlterTable
ALTER TABLE "ai_email_connections"
  ADD COLUMN "import_start_at" TIMESTAMPTZ(6),
  ADD COLUMN "sender_filter" TEXT;
