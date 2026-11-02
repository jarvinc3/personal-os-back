-- CreateEnum
CREATE TYPE "fin_signal_import_status" AS ENUM (
  'REVIEW_REQUIRED',
  'IMPORTED',
  'DUPLICATE',
  'REVERSED',
  'FAILED'
);

-- CreateTable
CREATE TABLE "fin_signal_imports" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "signal_id" TEXT NOT NULL,
  "source_email_message_id" TEXT NOT NULL,
  "status" "fin_signal_import_status" NOT NULL,
  "review_reason" TEXT,
  "transaction_id" TEXT,
  "duplicate_of_transaction_id" TEXT,
  "candidate" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fin_signal_imports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fin_signal_imports_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fin_signal_imports_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_signal_imports_user_signal_key"
  ON "fin_signal_imports"("user_id", "signal_id");
CREATE INDEX "fin_signal_imports_user_status_created_idx"
  ON "fin_signal_imports"("user_id", "status", "created_at" DESC);
CREATE INDEX "fin_signal_imports_user_email_idx"
  ON "fin_signal_imports"("user_id", "source_email_message_id");

ALTER TABLE "fin_signal_imports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fin_signal_imports_all_own" ON "fin_signal_imports"
  AS PERMISSIVE FOR ALL TO "authenticated"
  USING ("user_id" = ((SELECT auth.uid()))::text)
  WITH CHECK ("user_id" = ((SELECT auth.uid()))::text);
