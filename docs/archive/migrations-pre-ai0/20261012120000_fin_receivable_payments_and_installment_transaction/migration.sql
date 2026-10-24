-- Amounts collected for a receivable. The receivable balance is the sum of
-- these rows, and each one carries the movement that put the money in the account.
CREATE TABLE IF NOT EXISTS "fin_receivable_payments" (
  "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
  "receivable_id" TEXT NOT NULL,
  "amount" DECIMAL(15, 2) NOT NULL,
  "paid_at" DATE NOT NULL,
  "account_id" TEXT,
  "transaction_id" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fin_receivable_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fin_receivable_payments_transaction_id_key"
  ON "fin_receivable_payments"("transaction_id");

CREATE INDEX IF NOT EXISTS "fin_receivable_payments_receivable_id_paid_at_idx"
  ON "fin_receivable_payments"("receivable_id", "paid_at");

CREATE INDEX IF NOT EXISTS "fin_receivable_payments_account_id_idx"
  ON "fin_receivable_payments"("account_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_receivable_payments_receivable_id_fkey'
  ) THEN
    ALTER TABLE "fin_receivable_payments"
      ADD CONSTRAINT "fin_receivable_payments_receivable_id_fkey"
      FOREIGN KEY ("receivable_id") REFERENCES "fin_receivables"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_receivable_payments_account_id_fkey'
  ) THEN
    ALTER TABLE "fin_receivable_payments"
      ADD CONSTRAINT "fin_receivable_payments_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_receivable_payments_transaction_id_fkey'
  ) THEN
    ALTER TABLE "fin_receivable_payments"
      ADD CONSTRAINT "fin_receivable_payments_transaction_id_fkey"
      FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- The same link on loan instalments, so a paid instalment can be undone together
-- with the movement it created.
ALTER TABLE "fin_loan_installments" ADD COLUMN IF NOT EXISTS "transaction_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "fin_loan_installments_transaction_id_key"
  ON "fin_loan_installments"("transaction_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_loan_installments_transaction_id_fkey'
  ) THEN
    ALTER TABLE "fin_loan_installments"
      ADD CONSTRAINT "fin_loan_installments_transaction_id_fkey"
      FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- Balances collected before the history existed become one opening payment, so
-- the sum of the rows still matches the balance users already saw.
INSERT INTO "fin_receivable_payments" ("receivable_id", "amount", "paid_at", "notes")
SELECT "id", "paid_amount", "created_at"::date, 'Saldo inicial'
FROM "fin_receivables"
WHERE "paid_amount" > 0;
