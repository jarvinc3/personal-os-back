-- Category on each subscription, plus per-date alert dismissals.

-- CreateEnum
CREATE TYPE "fin_subscription_alert_kind" AS ENUM ('PRICE_INCREASE', 'TRIAL_ENDING', 'ANNUAL_RENEWAL', 'MISSED_CHARGE');

-- AlterTable
ALTER TABLE "fin_subscriptions" ADD COLUMN "category_id" TEXT;

-- CreateTable
CREATE TABLE "fin_subscription_alert_dismissals" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "kind" "fin_subscription_alert_kind" NOT NULL,
    "alert_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_subscription_alert_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_subscriptions_category_id_idx" ON "fin_subscriptions"("category_id");

-- CreateIndex
CREATE INDEX "fin_subscription_alert_dismissals_user_idx" ON "fin_subscription_alert_dismissals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_subscription_alert_dismissals_uq" ON "fin_subscription_alert_dismissals"("subscription_id", "kind", "alert_date");

-- AddForeignKey
ALTER TABLE "fin_subscriptions" ADD CONSTRAINT "fin_subscriptions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscription_alert_dismissals" ADD CONSTRAINT "fin_subscription_alert_dismissals_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "fin_subscriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscription_alert_dismissals" ADD CONSTRAINT "fin_subscription_alert_dismissals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
