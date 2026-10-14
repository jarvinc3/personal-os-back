-- Internal balance integrity (invariant I1): the stored balance of an account
-- or card must equal the sum of its confirmed movements. A row records a
-- deviation; "Recalcular" closes it after correcting the stored balance.
-- The migration creates no rows, so it cannot introduce drift.

-- CreateTable
CREATE TABLE "fin_balance_drifts" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT,
    "card_id" TEXT,
    "currency" TEXT NOT NULL,
    "stored_balance" DECIMAL(15,2) NOT NULL,
    "expected_balance" DECIMAL(15,2) NOT NULL,
    "difference" DECIMAL(15,2) NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "fin_balance_drifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_balance_drifts_user_resolved_idx" ON "fin_balance_drifts"("user_id", "resolved_at");

-- CreateIndex
CREATE INDEX "fin_balance_drifts_account_resolved_idx" ON "fin_balance_drifts"("account_id", "resolved_at");

-- CreateIndex
CREATE INDEX "fin_balance_drifts_card_resolved_idx" ON "fin_balance_drifts"("card_id", "resolved_at");

-- AddForeignKey
ALTER TABLE "fin_balance_drifts" ADD CONSTRAINT "fin_balance_drifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_balance_drifts" ADD CONSTRAINT "fin_balance_drifts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_balance_drifts" ADD CONSTRAINT "fin_balance_drifts_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- A drift belongs to exactly one product.
ALTER TABLE "fin_balance_drifts" ADD CONSTRAINT "fin_balance_drifts_target_check" CHECK (num_nonnulls("account_id", "card_id") = 1);
