-- last_four belongs on cards, not accounts.
-- Transactions keep a single pointer: FK to fin_email_messages.id (Gmail id stays on the message).

ALTER TABLE "fin_accounts" DROP CONSTRAINT IF EXISTS "fin_accounts_last_four_digits_check";
ALTER TABLE "fin_accounts" DROP COLUMN IF EXISTS "last_four";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_accounts_institution_by_type_check'
  ) THEN
    ALTER TABLE "fin_accounts"
      ADD CONSTRAINT "fin_accounts_institution_by_type_check"
      CHECK ("type" = 'CASH' OR "institution_id" IS NOT NULL);
  END IF;
END $$;

ALTER TABLE "fin_transactions" DROP CONSTRAINT IF EXISTS "fin_transactions_email_message_row_id_fkey";
DROP INDEX IF EXISTS "fin_transactions_email_message_row_id_key";
DROP INDEX IF EXISTS "fin_transactions_email_message_id_idx";
DROP INDEX IF EXISTS "fin_transactions_email_message_id_key";

ALTER TABLE "fin_transactions" DROP COLUMN IF EXISTS "email_message_id";
ALTER TABLE "fin_transactions" RENAME COLUMN "email_message_row_id" TO "email_message_id";

ALTER TABLE "fin_transactions"
  ADD CONSTRAINT "fin_transactions_email_message_id_fkey"
  FOREIGN KEY ("email_message_id") REFERENCES "fin_email_messages"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE UNIQUE INDEX "fin_transactions_email_message_id_key"
  ON "fin_transactions"("email_message_id");
