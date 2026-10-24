-- French loan schedule: per-installment breakdown, rate type, prepayments and
-- the installment status. Existing paid installments are marked as paid.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fin_installment_status') THEN
    CREATE TYPE "fin_installment_status" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fin_rate_type') THEN
    CREATE TYPE "fin_rate_type" AS ENUM ('FIXED', 'VARIABLE');
  END IF;
END $$;

ALTER TABLE "fin_loans"
  ADD COLUMN IF NOT EXISTS "rate_type" "fin_rate_type" NOT NULL DEFAULT 'FIXED',
  ADD COLUMN IF NOT EXISTS "insurance_amount" DECIMAL(15, 2),
  ADD COLUMN IF NOT EXISTS "late_fee_policy" JSONB,
  ADD COLUMN IF NOT EXISTS "prepayment_penalty_pct" DECIMAL(5, 4),
  ADD COLUMN IF NOT EXISTS "disbursement_date" DATE;

ALTER TABLE "fin_loan_installments"
  ADD COLUMN IF NOT EXISTS "principal" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "interest" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "insurance" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "fees" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "late_fee" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paid_amount" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "status" "fin_installment_status" NOT NULL DEFAULT 'PENDING';

UPDATE "fin_loan_installments"
SET "status" = 'PAID', "paid_amount" = "amount"
WHERE "paid_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "fin_loan_prepayments" (
  "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
  "loan_id" TEXT NOT NULL,
  "amount" DECIMAL(15, 2) NOT NULL,
  "penalty" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  "mode" TEXT NOT NULL,
  "paid_at" DATE NOT NULL,
  "transaction_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "fin_loan_prepayments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fin_loan_prepayments_transaction_id_key"
  ON "fin_loan_prepayments"("transaction_id");
CREATE INDEX IF NOT EXISTS "fin_loan_prepayments_loan_paid_idx"
  ON "fin_loan_prepayments"("loan_id", "paid_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_loan_prepayments_loan_id_fkey') THEN
    ALTER TABLE "fin_loan_prepayments"
      ADD CONSTRAINT "fin_loan_prepayments_loan_id_fkey"
      FOREIGN KEY ("loan_id") REFERENCES "fin_loans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_loan_prepayments_transaction_id_fkey') THEN
    ALTER TABLE "fin_loan_prepayments"
      ADD CONSTRAINT "fin_loan_prepayments_transaction_id_fkey"
      FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
