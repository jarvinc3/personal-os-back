-- Accounts can exist without an institution. The Prisma schema already
-- models institution_id as optional; the live table was still NOT NULL.
ALTER TABLE "fin_accounts" ALTER COLUMN "institution_id" DROP NOT NULL;
