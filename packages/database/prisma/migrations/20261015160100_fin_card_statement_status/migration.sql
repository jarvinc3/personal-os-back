-- Statement status fields, category system kind, and the one-time conversion of
-- card transfers into CARD_PAYMENT.

ALTER TABLE "fin_card_statements"
  ADD COLUMN IF NOT EXISTS "minimum_payment" DECIMAL(15, 2),
  ADD COLUMN IF NOT EXISTS "minimum_source" "fin_amount_source",
  ADD COLUMN IF NOT EXISTS "status" "fin_card_statement_status" NOT NULL DEFAULT 'CLOSED',
  ADD COLUMN IF NOT EXISTS "imported_at" TIMESTAMPTZ(6);

ALTER TABLE "fin_categories"
  ADD COLUMN IF NOT EXISTS "system_kind" TEXT;

-- A card transfer already had the same balance effect; only the type changes.
UPDATE "fin_transactions"
SET "type" = 'CARD_PAYMENT'
WHERE "transfer_group_id" IN (
  SELECT "transfer_group_id"
  FROM "fin_transactions"
  WHERE "card_id" IS NOT NULL AND "transfer_group_id" IS NOT NULL
);
