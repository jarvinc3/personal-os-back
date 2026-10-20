-- A cross-currency transfer that used the market rate without a user-provided
-- rate or received amount stays marked as estimated.
ALTER TABLE "fin_transactions"
ADD COLUMN "is_estimated" BOOLEAN NOT NULL DEFAULT false;
