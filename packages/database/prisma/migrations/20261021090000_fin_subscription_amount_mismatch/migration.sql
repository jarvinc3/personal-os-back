-- A charge that differs from the expected amount becomes its own alert kind.

-- AlterEnum
ALTER TYPE "fin_subscription_alert_kind" ADD VALUE 'AMOUNT_MISMATCH' AFTER 'PRICE_INCREASE';
