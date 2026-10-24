-- #139: encrypt bank account numbers and close pending schema gaps.
--
-- `account_number` now stores AES-256-GCM ciphertext. `account_number_last4`
-- and the HMAC fingerprint keep display and duplicate detection working
-- without decrypting. Existing plaintext rows are encrypted by
-- `scripts/finance/encrypt-account-numbers.ts`, which is idempotent and runs
-- once per environment after this migration.

ALTER TABLE "fin_accounts"
ADD COLUMN "account_number_last4" TEXT,
ADD COLUMN "account_number_hash" TEXT;

DROP INDEX IF EXISTS "fin_accounts_user_institution_number_key";

CREATE UNIQUE INDEX "fin_accounts_user_institution_number_hash_key"
ON "fin_accounts"("user_id", "institution_id", "account_number_hash");

-- One budget per user/category/period plus a valid range. Dev was checked for
-- duplicate keys before adding the unique index (none found).
ALTER TABLE "fin_budgets"
ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "fin_budgets_user_category_period_key"
ON "fin_budgets"("user_id", "category_id", "period_start");

ALTER TABLE "fin_budgets"
ADD CONSTRAINT "fin_budgets_period_range_check" CHECK ("period_end" >= "period_start");

-- Email sources track their last change.
ALTER TABLE "fin_email_sources"
ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Every AI action records its user for auditing, backfilled from its session.
ALTER TABLE "ai_actions" ADD COLUMN "user_id" TEXT;
ALTER TABLE "ai_actions" ADD COLUMN "created_at" TIMESTAMPTZ(6);

UPDATE "ai_actions" AS action
SET "user_id" = session."user_id"
FROM "ai_agent_sessions" AS session
WHERE session."id" = action."session_id" AND action."user_id" IS NULL;

UPDATE "ai_actions" AS action
SET "created_at" = COALESCE(action."executed_at", session."created_at")
FROM "ai_agent_sessions" AS session
WHERE session."id" = action."session_id" AND action."created_at" IS NULL;

ALTER TABLE "ai_actions" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "ai_actions" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "ai_actions" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ai_actions"
ADD CONSTRAINT "ai_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE INDEX "ai_actions_user_id_idx" ON "ai_actions"("user_id");
