-- Origin of a merchant category so the app can show it as suggested and never
-- overwrite a manual one. No backfill: existing merchants stay without source.
CREATE TYPE "fin_merchant_category_source" AS ENUM ('MANUAL', 'LEARNED', 'KEYWORD');

ALTER TABLE "fin_merchants" ADD COLUMN     "category_source" "fin_merchant_category_source";
