-- transaction_date: date -> timestamptz (preserve calendar day at UTC midnight)
ALTER TABLE "fin_transactions"
  ALTER COLUMN "transaction_date" TYPE TIMESTAMPTZ(6)
  USING ("transaction_date"::timestamp AT TIME ZONE 'UTC');

ALTER TABLE "fin_transactions"
ADD COLUMN IF NOT EXISTS "transfer_group_id" TEXT;

CREATE INDEX IF NOT EXISTS "fin_transactions_transfer_group_id_idx" ON "fin_transactions" ("transfer_group_id")
WHERE
    "transfer_group_id" IS NOT NULL;