-- Reconciling an account or card against the balance the bank shows.
-- One row per close, plus one categorized line per adjustment movement.

-- CreateEnum
CREATE TYPE "fin_reconciliation_adjustment_kind" AS ENUM ('IMPUESTO_DGII', 'COMISION', 'CARGO_PLASTICO', 'INTERES', 'OTRO');

-- CreateTable
CREATE TABLE "fin_reconciliations" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT,
    "card_id" TEXT,
    "currency" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "app_balance" DECIMAL(15,2) NOT NULL,
    "real_balance" DECIMAL(15,2) NOT NULL,
    "difference" DECIMAL(15,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_reconciliation_adjustments" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "reconciliation_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "kind" "fin_reconciliation_adjustment_kind" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "fin_reconciliation_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_reconciliations_user_account_date_idx" ON "fin_reconciliations"("user_id", "account_id", "as_of_date" DESC);

-- CreateIndex
CREATE INDEX "fin_reconciliations_user_card_date_idx" ON "fin_reconciliations"("user_id", "card_id", "as_of_date" DESC);

-- CreateIndex
CREATE INDEX "fin_reconciliations_account_id_idx" ON "fin_reconciliations"("account_id");

-- CreateIndex
CREATE INDEX "fin_reconciliations_card_id_idx" ON "fin_reconciliations"("card_id");

-- CreateIndex
CREATE INDEX "fin_reconciliation_adjustments_reconciliation_idx" ON "fin_reconciliation_adjustments"("reconciliation_id");

-- CreateIndex
CREATE INDEX "fin_reconciliation_adjustments_transaction_idx" ON "fin_reconciliation_adjustments"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_reconciliation_adjustments_transaction_id_key" ON "fin_reconciliation_adjustments"("transaction_id");

-- AddForeignKey
ALTER TABLE "fin_reconciliations" ADD CONSTRAINT "fin_reconciliations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_reconciliations" ADD CONSTRAINT "fin_reconciliations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_reconciliations" ADD CONSTRAINT "fin_reconciliations_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_reconciliation_adjustments" ADD CONSTRAINT "fin_reconciliation_adjustments_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "fin_reconciliations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_reconciliation_adjustments" ADD CONSTRAINT "fin_reconciliation_adjustments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- A close belongs to exactly one product.
ALTER TABLE "fin_reconciliations" ADD CONSTRAINT "fin_reconciliations_target_check" CHECK (num_nonnulls("account_id", "card_id") = 1);

-- System categories so the bank-charge analytics can group by kind. COMISION
-- and INTERES reuse the categories seeded for card charges. Idempotent.
INSERT INTO "fin_categories" (
  "id",
  "user_id",
  "name",
  "icon",
  "color",
  "parent_id",
  "is_system",
  "system_kind",
  "type",
  "created_at",
  "updated_at"
)
SELECT
  '1a4b7c9d-2e3f-4a5b-8c6d-7e8f90123456',
  NULL,
  'Impuesto DGII',
  NULL,
  '#7c3aed',
  NULL,
  true,
  'TAX_DGII',
  'EXPENSE'::"FinCategoryType",
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "fin_categories"
  WHERE "is_system" = true AND "system_kind" = 'TAX_DGII'
);

INSERT INTO "fin_categories" (
  "id",
  "user_id",
  "name",
  "icon",
  "color",
  "parent_id",
  "is_system",
  "system_kind",
  "type",
  "created_at",
  "updated_at"
)
SELECT
  '2b5c8d0e-3f4a-4b6c-9d7e-8f901234567a',
  NULL,
  'Cargo por plástico',
  NULL,
  '#ea580c',
  NULL,
  true,
  'PLASTIC_FEE',
  'EXPENSE'::"FinCategoryType",
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "fin_categories"
  WHERE "is_system" = true AND "system_kind" = 'PLASTIC_FEE'
);

INSERT INTO "fin_categories" (
  "id",
  "user_id",
  "name",
  "icon",
  "color",
  "parent_id",
  "is_system",
  "system_kind",
  "type",
  "created_at",
  "updated_at"
)
SELECT
  '3c6d9e1f-4a5b-4c7d-8e9f-90123456789b',
  NULL,
  'Otros cargos bancarios',
  NULL,
  '#475569',
  NULL,
  true,
  'OTHER_BANK_CHARGE',
  'EXPENSE'::"FinCategoryType",
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "fin_categories"
  WHERE "is_system" = true AND "system_kind" = 'OTHER_BANK_CHARGE'
);
