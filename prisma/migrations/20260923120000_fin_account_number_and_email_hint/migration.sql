-- Bank account numbers for email matching, plus extractor hint on email messages.
-- Nullable so CASH and existing rows stay valid.

ALTER TABLE "fin_accounts"
ADD COLUMN IF NOT EXISTS "account_number" TEXT;

ALTER TABLE "fin_email_messages"
ADD COLUMN IF NOT EXISTS "account_number_hint" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "fin_accounts_user_institution_number_key"
ON "fin_accounts"("user_id", "institution_id", "account_number")
WHERE "account_number" IS NOT NULL;
