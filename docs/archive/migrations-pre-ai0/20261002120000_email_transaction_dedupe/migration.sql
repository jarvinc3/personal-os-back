-- Bank reference on imported transactions plus email outcomes for
-- deduplicated notices and reversals pending an original transaction.

ALTER TABLE "fin_transactions"
ADD COLUMN IF NOT EXISTS "external_reference" TEXT;

CREATE INDEX IF NOT EXISTS "fin_transactions_user_ref_idx"
ON "fin_transactions"("user_id", "external_reference");

ALTER TYPE "FinEmailMessageOutcome" RENAME TO "FinEmailMessageOutcome_old";
CREATE TYPE "FinEmailMessageOutcome" AS ENUM (
  'IMPORTED',
  'SKIPPED_NOT_TX',
  'FAILED_NON_RETRYABLE',
  'PENDING_ASSIGNMENT',
  'PENDING_AMOUNT',
  'SKIPPED_DUPLICATE',
  'PENDING_REVERSE'
);
ALTER TABLE "fin_email_messages"
  ALTER COLUMN "outcome" TYPE "FinEmailMessageOutcome"
  USING ("outcome"::text::"FinEmailMessageOutcome");
DROP TYPE "FinEmailMessageOutcome_old";
