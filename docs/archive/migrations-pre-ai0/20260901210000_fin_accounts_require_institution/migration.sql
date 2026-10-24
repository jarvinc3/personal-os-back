-- Accounts must belong to a bank institution. Drop the denormalized name.
DELETE FROM "fin_accounts" WHERE "institution_id" IS NULL;
ALTER TABLE "fin_accounts" DROP COLUMN IF EXISTS "institution";
ALTER TABLE "fin_accounts" ALTER COLUMN "institution_id" SET NOT NULL;
