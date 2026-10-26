-- Aliases move to their own table so a text can be looked up by a unique,
-- normalized key per user. No backfill: the existing list is test data.
CREATE TABLE "fin_merchant_aliases" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_merchant_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fin_merchant_aliases_user_key_uq" ON "fin_merchant_aliases"("user_id", "normalized_key");

CREATE INDEX "fin_merchant_aliases_merchant_id_idx" ON "fin_merchant_aliases"("merchant_id");

ALTER TABLE "fin_merchant_aliases" ADD CONSTRAINT "fin_merchant_aliases_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "fin_merchants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "fin_merchant_aliases" ADD CONSTRAINT "fin_merchant_aliases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "fin_merchants" DROP COLUMN "aliases";
