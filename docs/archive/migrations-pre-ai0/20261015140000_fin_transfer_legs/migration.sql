-- Leg role and transfer rail for multi-leg operations, plus the system expense
-- category a transfer fee uses.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fin_operation_leg_role') THEN
    CREATE TYPE "fin_operation_leg_role" AS ENUM ('SOURCE', 'DESTINATION', 'FEE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fin_transfer_rail') THEN
    CREATE TYPE "fin_transfer_rail" AS ENUM ('SAME_BANK', 'ACH', 'LBTR', 'OTHER');
  END IF;
END $$;

ALTER TABLE "fin_transactions"
  ADD COLUMN IF NOT EXISTS "leg_role" "fin_operation_leg_role",
  ADD COLUMN IF NOT EXISTS "rail" "fin_transfer_rail";

UPDATE "fin_transactions"
SET "leg_role" = 'SOURCE'
WHERE "transfer_group_id" IS NOT NULL AND "type" = 'DEBIT' AND "leg_role" IS NULL;

UPDATE "fin_transactions"
SET "leg_role" = 'DESTINATION'
WHERE "transfer_group_id" IS NOT NULL AND "type" = 'CREDIT' AND "leg_role" IS NULL;

-- Fee leg goes on a real expense category so it counts in budgets.
INSERT INTO "fin_categories" (
  "id",
  "user_id",
  "name",
  "icon",
  "color",
  "parent_id",
  "is_system",
  "type",
  "created_at",
  "updated_at"
)
SELECT
  'b7f6f2a1-6d2e-4f3b-9c1a-2e5d8f4a7c31',
  NULL,
  'Comisiones bancarias',
  NULL,
  '#64748b',
  NULL,
  true,
  'EXPENSE'::"FinCategoryType",
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "fin_categories"
  WHERE "is_system" = true AND "name" = 'Comisiones bancarias'
);
