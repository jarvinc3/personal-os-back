-- CreateEnum
CREATE TYPE "fin_recurring_status" AS ENUM ('SUGGESTED', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "fin_recurring_kind" AS ENUM ('SUBSCRIPTION', 'BILL', 'INCOME', 'OTHER');

-- AlterTable
ALTER TABLE "fin_transactions" ADD COLUMN "merchant_id" TEXT;

-- AlterTable
ALTER TABLE "fin_recurring_patterns" ADD COLUMN "merchant_id" TEXT,
ADD COLUMN "amount_tolerance" DECIMAL(5,2) NOT NULL DEFAULT 10,
ADD COLUMN "status" "fin_recurring_status" NOT NULL DEFAULT 'SUGGESTED',
ADD COLUMN "kind" "fin_recurring_kind" NOT NULL DEFAULT 'SUBSCRIPTION',
ADD COLUMN "last_seen_at" TIMESTAMPTZ(6),
ADD COLUMN "confirmed_at" TIMESTAMPTZ(6),
ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "fin_merchants" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category_id" TEXT,
    "logo_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_merchants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_transactions_merchant_id_idx" ON "fin_transactions"("merchant_id");

-- CreateIndex
CREATE INDEX "fin_recurring_patterns_user_status_idx" ON "fin_recurring_patterns"("user_id", "status");

-- CreateIndex
CREATE INDEX "fin_recurring_patterns_user_next_date_idx" ON "fin_recurring_patterns"("user_id", "next_expected_date");

-- CreateIndex
CREATE INDEX "fin_merchants_user_id_idx" ON "fin_merchants"("user_id");

-- CreateIndex
CREATE INDEX "fin_merchants_category_id_idx" ON "fin_merchants"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_merchants_user_normalized_key_uq" ON "fin_merchants"("user_id", "normalized_key");

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "fin_merchants"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_recurring_patterns" ADD CONSTRAINT "fin_recurring_patterns_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "fin_merchants"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_merchants" ADD CONSTRAINT "fin_merchants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_merchants" ADD CONSTRAINT "fin_merchants_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
