-- Closed billing cycles per credit card and per currency.
CREATE TABLE IF NOT EXISTS "fin_card_statements" (
  "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
  "card_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "cycle_start" DATE NOT NULL,
  "cycle_end" DATE NOT NULL,
  "due_date" DATE,
  "closing_balance" DECIMAL(15, 2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fin_card_statements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fin_card_statements_card_currency_cycle_key"
  ON "fin_card_statements"("card_id", "currency", "cycle_end");

CREATE INDEX IF NOT EXISTS "fin_card_statements_card_id_cycle_end_idx"
  ON "fin_card_statements"("card_id", "cycle_end");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_card_statements_card_id_fkey'
  ) THEN
    ALTER TABLE "fin_card_statements"
      ADD CONSTRAINT "fin_card_statements_card_id_fkey"
      FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- Scheduled instalments of a loan. paid_at null means unpaid.
CREATE TABLE IF NOT EXISTS "fin_loan_installments" (
  "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
  "loan_id" TEXT NOT NULL,
  "installment_no" INTEGER NOT NULL,
  "due_date" DATE NOT NULL,
  "amount" DECIMAL(15, 2) NOT NULL,
  "paid_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fin_loan_installments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fin_loan_installments_loan_no_key"
  ON "fin_loan_installments"("loan_id", "installment_no");

CREATE INDEX IF NOT EXISTS "fin_loan_installments_loan_id_due_idx"
  ON "fin_loan_installments"("loan_id", "due_date");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_loan_installments_loan_id_fkey'
  ) THEN
    ALTER TABLE "fin_loan_installments"
      ADD CONSTRAINT "fin_loan_installments_loan_id_fkey"
      FOREIGN KEY ("loan_id") REFERENCES "fin_loans"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
