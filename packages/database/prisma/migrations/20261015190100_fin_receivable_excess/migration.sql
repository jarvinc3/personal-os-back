-- Receivable credit balance, write-off and payment split. `applied_amount` is
-- added nullable, backfilled from `amount`, then made required.

ALTER TABLE "fin_receivables"
  ADD COLUMN IF NOT EXISTS "credit_balance" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "written_off_amount" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "written_off_at" TIMESTAMPTZ(6);

ALTER TABLE "fin_receivable_payments"
  ADD COLUMN IF NOT EXISTS "applied_amount" DECIMAL(15, 2),
  ADD COLUMN IF NOT EXISTS "excess_amount" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "excess_handling" TEXT;

UPDATE "fin_receivable_payments"
SET "applied_amount" = "amount"
WHERE "applied_amount" IS NULL;

ALTER TABLE "fin_receivable_payments"
  ALTER COLUMN "applied_amount" SET NOT NULL;
