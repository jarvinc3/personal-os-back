-- CreateEnum
CREATE TYPE "fin_billing_cycle" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY');

-- CreateEnum
CREATE TYPE "fin_subscription_status" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "fin_subscription_payment_source" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "fin_subscriptions" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "domain" TEXT,
    "logo_path" TEXT,
    "custom_logo_path" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "billing_cycle" "fin_billing_cycle" NOT NULL,
    "billing_interval" INTEGER NOT NULL DEFAULT 1,
    "anchor_date" DATE NOT NULL,
    "next_billing_date" DATE NOT NULL,
    "trial_ends_at" DATE,
    "status" "fin_subscription_status" NOT NULL DEFAULT 'ACTIVE',
    "paused_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "reminder_days_before" INTEGER NOT NULL DEFAULT 3,
    "last_reminded_for" DATE,
    "card_id" TEXT,
    "account_id" TEXT,
    "manage_url" TEXT,
    "notes" TEXT,
    "source_pattern_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_subscription_payments" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "subscription_id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "source" "fin_subscription_payment_source" NOT NULL DEFAULT 'AUTO',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_subscriptions_user_status_idx" ON "fin_subscriptions"("user_id", "status");

-- CreateIndex
CREATE INDEX "fin_subscriptions_user_next_billing_idx" ON "fin_subscriptions"("user_id", "next_billing_date");

-- CreateIndex
CREATE INDEX "fin_subscriptions_card_id_idx" ON "fin_subscriptions"("card_id");

-- CreateIndex
CREATE INDEX "fin_subscriptions_account_id_idx" ON "fin_subscriptions"("account_id");

-- CreateIndex
CREATE INDEX "fin_subscriptions_source_pattern_id_idx" ON "fin_subscriptions"("source_pattern_id");

-- CreateIndex
CREATE INDEX "fin_subscription_payments_sub_paid_idx" ON "fin_subscription_payments"("subscription_id", "paid_at");

-- CreateIndex
CREATE INDEX "fin_subscription_payments_transaction_id_idx" ON "fin_subscription_payments"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_subscription_payments_sub_tx_uq" ON "fin_subscription_payments"("subscription_id", "transaction_id");

-- AddForeignKey
ALTER TABLE "fin_subscriptions" ADD CONSTRAINT "fin_subscriptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscriptions" ADD CONSTRAINT "fin_subscriptions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscriptions" ADD CONSTRAINT "fin_subscriptions_source_pattern_id_fkey" FOREIGN KEY ("source_pattern_id") REFERENCES "fin_recurring_patterns"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscriptions" ADD CONSTRAINT "fin_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscription_payments" ADD CONSTRAINT "fin_subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "fin_subscriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscription_payments" ADD CONSTRAINT "fin_subscription_payments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

