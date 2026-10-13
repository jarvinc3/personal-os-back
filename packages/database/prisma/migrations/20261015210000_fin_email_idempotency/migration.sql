-- Strong idempotency for bank emails: institution on the movement, a partial
-- unique index on the bank reference, and the email fingerprint. Existing
-- duplicates must be removed with `scripts/finance/dedupe-existing.ts` (it
-- compensates balances through the journal) before this index can be created.

ALTER TABLE "fin_transactions"
  ADD COLUMN IF NOT EXISTS "institution_id" TEXT,
  ADD COLUMN IF NOT EXISTS "possible_duplicate_of_id" TEXT;

ALTER TABLE "fin_email_messages"
  ADD COLUMN IF NOT EXISTS "fingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "duplicate_of_transaction_id" TEXT;

-- Backfill the institution from the account or the card.
UPDATE "fin_transactions" t
SET "institution_id" = a."institution_id"
FROM "fin_accounts" a
WHERE t."account_id" = a."id" AND t."institution_id" IS NULL;

UPDATE "fin_transactions" t
SET "institution_id" = c."institution_id"
FROM "fin_cards" c
WHERE t."card_id" = c."id" AND t."institution_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "fin_transactions_user_inst_ref_key"
  ON "fin_transactions"("user_id", "institution_id", "external_reference")
  WHERE "external_reference" IS NOT NULL AND "status" <> 'REVERSED';
