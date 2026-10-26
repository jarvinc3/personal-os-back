-- Pairs of merchants the user marked as "not a duplicate". The pair is stored
-- in canonical order so A-B and B-A are one row, and it disappears with either
-- merchant.
CREATE TABLE "fin_merchant_duplicate_dismissals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "other_merchant_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_merchant_duplicate_dismissals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fin_merchant_duplicate_dismissals_pair_uq" ON "fin_merchant_duplicate_dismissals"("user_id", "merchant_id", "other_merchant_id");

CREATE INDEX "fin_merchant_duplicate_dismissals_merchant_id_idx" ON "fin_merchant_duplicate_dismissals"("merchant_id");

CREATE INDEX "fin_merchant_duplicate_dismissals_other_id_idx" ON "fin_merchant_duplicate_dismissals"("other_merchant_id");

ALTER TABLE "fin_merchant_duplicate_dismissals" ADD CONSTRAINT "fin_merchant_duplicate_dismissals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "fin_merchant_duplicate_dismissals" ADD CONSTRAINT "fin_merchant_duplicate_dismissals_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "fin_merchants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "fin_merchant_duplicate_dismissals" ADD CONSTRAINT "fin_merchant_duplicate_dismissals_other_merchant_id_fkey" FOREIGN KEY ("other_merchant_id") REFERENCES "fin_merchants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
