-- Default account per institution, payroll amount-pending outcome,
-- and multiple allowlisted senders per email source.

ALTER TABLE "fin_accounts"
ADD COLUMN IF NOT EXISTS "is_default_for_institution" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "fin_accounts_user_institution_default_key"
ON "fin_accounts"("user_id", "institution_id")
WHERE "is_default_for_institution" = true
  AND "institution_id" IS NOT NULL
  AND "is_active" = true;

ALTER TABLE "fin_email_sources"
ADD COLUMN IF NOT EXISTS "bank_sender_emails" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "fin_email_sources"
SET "bank_sender_emails" = ARRAY["bank_sender_email"]
WHERE "bank_sender_email" IS NOT NULL
  AND btrim("bank_sender_email") <> ''
  AND cardinality("bank_sender_emails") = 0;

ALTER TABLE "fin_email_sources"
DROP COLUMN IF EXISTS "bank_sender_email";

ALTER TYPE "FinEmailMessageOutcome" RENAME TO "FinEmailMessageOutcome_old";
CREATE TYPE "FinEmailMessageOutcome" AS ENUM (
  'IMPORTED',
  'SKIPPED_NOT_TX',
  'FAILED_NON_RETRYABLE',
  'PENDING_ASSIGNMENT',
  'PENDING_AMOUNT'
);
ALTER TABLE "fin_email_messages"
  ALTER COLUMN "outcome" TYPE "FinEmailMessageOutcome"
  USING ("outcome"::text::"FinEmailMessageOutcome");
DROP TYPE "FinEmailMessageOutcome_old";
