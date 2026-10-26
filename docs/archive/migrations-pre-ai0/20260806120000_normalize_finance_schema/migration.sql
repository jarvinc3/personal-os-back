-- Normalize finance schema: types, constraints, FKs, indexes, and hardened RLS.
-- Safe on empty dev data; validates existing rows before CHECK constraints.

-- ── Types: TEXT currencies / last_four ──────────────────────────────────────

ALTER TABLE "fin_cards" ALTER COLUMN "last_four" TYPE TEXT USING NULLIF(BTRIM("last_four"::text), '');

ALTER TABLE "fin_card_balances" ALTER COLUMN "currency" TYPE TEXT USING UPPER(BTRIM("currency"::text));

ALTER TABLE "fin_savings_goals" ALTER COLUMN "currency" TYPE TEXT USING UPPER(BTRIM("currency"::text));

ALTER TABLE "fin_loans" ALTER COLUMN "currency" TYPE TEXT USING UPPER(BTRIM("currency"::text));

ALTER TABLE "fin_receivables" ALTER COLUMN "currency" TYPE TEXT USING UPPER(BTRIM("currency"::text));

UPDATE "fin_accounts" SET "currency" = UPPER(BTRIM("currency"));
UPDATE "fin_transactions" SET "currency" = UPPER(BTRIM("currency"));
UPDATE "fin_recurring_patterns" SET "currency" = UPPER(BTRIM("currency"));
UPDATE "fin_card_balances" SET "currency" = UPPER(BTRIM("currency"));
UPDATE "fin_savings_goals" SET "currency" = UPPER(BTRIM("currency"));
UPDATE "fin_loans" SET "currency" = UPPER(BTRIM("currency"));
UPDATE "fin_receivables" SET "currency" = UPPER(BTRIM("currency"));

-- ── Drop legacy account card-ish columns ────────────────────────────────────

ALTER TABLE "fin_accounts" DROP COLUMN IF EXISTS "credit_limit";
ALTER TABLE "fin_accounts" DROP COLUMN IF EXISTS "statement_closing_day";
ALTER TABLE "fin_accounts" DROP COLUMN IF EXISTS "payment_due_day";

-- ── Email source optional card target ───────────────────────────────────────

ALTER TABLE "fin_email_sources" ADD COLUMN IF NOT EXISTS "card_id" TEXT;

-- Clear invalid dual targets before CHECKs (prefer account if both set)
UPDATE "fin_email_sources"
SET "card_id" = NULL
WHERE "account_id" IS NOT NULL AND "card_id" IS NOT NULL;

UPDATE "fin_transactions"
SET "card_id" = NULL
WHERE "account_id" IS NOT NULL AND "card_id" IS NOT NULL;

UPDATE "fin_cards"
SET "account_id" = NULL
WHERE "type" = 'CREDIT';

-- ── Drop default period dates on budgets if present ──────────────────────────

ALTER TABLE "fin_budgets" ALTER COLUMN "period_start" DROP DEFAULT;
ALTER TABLE "fin_budgets" ALTER COLUMN "period_end" DROP DEFAULT;

-- ── CHECK constraints ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_accounts_currency_iso_check'
  ) THEN
    ALTER TABLE "fin_accounts"
      ADD CONSTRAINT "fin_accounts_currency_iso_check"
      CHECK ("currency" ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_transactions_currency_iso_check'
  ) THEN
    ALTER TABLE "fin_transactions"
      ADD CONSTRAINT "fin_transactions_currency_iso_check"
      CHECK ("currency" ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_card_balances_currency_iso_check'
  ) THEN
    ALTER TABLE "fin_card_balances"
      ADD CONSTRAINT "fin_card_balances_currency_iso_check"
      CHECK ("currency" ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_savings_goals_currency_iso_check'
  ) THEN
    ALTER TABLE "fin_savings_goals"
      ADD CONSTRAINT "fin_savings_goals_currency_iso_check"
      CHECK ("currency" ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_loans_currency_iso_check'
  ) THEN
    ALTER TABLE "fin_loans"
      ADD CONSTRAINT "fin_loans_currency_iso_check"
      CHECK ("currency" ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_receivables_currency_iso_check'
  ) THEN
    ALTER TABLE "fin_receivables"
      ADD CONSTRAINT "fin_receivables_currency_iso_check"
      CHECK ("currency" ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_recurring_patterns_currency_iso_check'
  ) THEN
    ALTER TABLE "fin_recurring_patterns"
      ADD CONSTRAINT "fin_recurring_patterns_currency_iso_check"
      CHECK ("currency" ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_cards_last_four_digits_check'
  ) THEN
    ALTER TABLE "fin_cards"
      ADD CONSTRAINT "fin_cards_last_four_digits_check"
      CHECK ("last_four" IS NULL OR "last_four" ~ '^[0-9]{4}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_cards_statement_day_check'
  ) THEN
    ALTER TABLE "fin_cards"
      ADD CONSTRAINT "fin_cards_statement_day_check"
      CHECK (
        "statement_closing_day" IS NULL
        OR ("statement_closing_day" >= 1 AND "statement_closing_day" <= 31)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_cards_payment_day_check'
  ) THEN
    ALTER TABLE "fin_cards"
      ADD CONSTRAINT "fin_cards_payment_day_check"
      CHECK (
        "payment_due_day" IS NULL
        OR ("payment_due_day" >= 1 AND "payment_due_day" <= 31)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_cards_type_account_check'
  ) THEN
    ALTER TABLE "fin_cards"
      ADD CONSTRAINT "fin_cards_type_account_check"
      CHECK (
        ("type" = 'DEBIT' AND "account_id" IS NOT NULL)
        OR ("type" = 'CREDIT' AND "account_id" IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_transactions_account_xor_card_check'
  ) THEN
    ALTER TABLE "fin_transactions"
      ADD CONSTRAINT "fin_transactions_account_xor_card_check"
      CHECK (num_nonnulls("account_id", "card_id") = 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_email_sources_account_xor_card_check'
  ) THEN
    ALTER TABLE "fin_email_sources"
      ADD CONSTRAINT "fin_email_sources_account_xor_card_check"
      CHECK (num_nonnulls("account_id", "card_id") <= 1);
  END IF;
END $$;

-- ── Unique budgets + auth outbox indexes ────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "fin_budgets_user_category_period_key"
  ON "fin_budgets"("user_id", "category_id", "period_start", "period_end");

CREATE UNIQUE INDEX IF NOT EXISTS "auth_deletion_outbox_user_id_key"
  ON "auth_deletion_outbox"("user_id");

CREATE INDEX IF NOT EXISTS "auth_deletion_outbox_status_next_attempt_idx"
  ON "auth_deletion_outbox"("status", "next_attempt_at");

-- ── Missing FK leading indexes ──────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "user_modules_module_id_idx" ON "user_modules"("module_id");
CREATE INDEX IF NOT EXISTS "ai_agent_sessions_module_id_idx" ON "ai_agent_sessions"("module_id");
CREATE INDEX IF NOT EXISTS "ai_actions_session_id_idx" ON "ai_actions"("session_id");
CREATE INDEX IF NOT EXISTS "ai_actions_message_id_idx" ON "ai_actions"("message_id");
CREATE INDEX IF NOT EXISTS "push_tokens_user_id_idx" ON "push_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "fin_accounts_institution_id_idx" ON "fin_accounts"("institution_id");
CREATE INDEX IF NOT EXISTS "fin_email_sources_account_id_idx" ON "fin_email_sources"("account_id");
CREATE INDEX IF NOT EXISTS "fin_email_sources_card_id_idx" ON "fin_email_sources"("card_id");
CREATE INDEX IF NOT EXISTS "fin_transactions_category_id_idx" ON "fin_transactions"("category_id");
CREATE INDEX IF NOT EXISTS "fin_categories_user_id_idx" ON "fin_categories"("user_id");
CREATE INDEX IF NOT EXISTS "fin_categories_parent_id_idx" ON "fin_categories"("parent_id");
CREATE INDEX IF NOT EXISTS "fin_budgets_category_id_idx" ON "fin_budgets"("category_id");
CREATE INDEX IF NOT EXISTS "fin_budget_alerts_budget_id_idx" ON "fin_budget_alerts"("budget_id");
CREATE INDEX IF NOT EXISTS "fin_recurring_patterns_user_id_idx" ON "fin_recurring_patterns"("user_id");
CREATE INDEX IF NOT EXISTS "fin_recurring_patterns_category_id_idx" ON "fin_recurring_patterns"("category_id");
CREATE INDEX IF NOT EXISTS "fin_cards_account_id_idx" ON "fin_cards"("account_id");
CREATE INDEX IF NOT EXISTS "fin_loans_account_id_idx" ON "fin_loans"("account_id");

-- Existing composite indexes that may be missing on live Supabase
CREATE INDEX IF NOT EXISTS "ai_agent_sessions_user_id_last_active_idx"
  ON "ai_agent_sessions"("user_id", "last_active_at");
CREATE INDEX IF NOT EXISTS "fin_accounts_user_id_active_idx"
  ON "fin_accounts"("user_id", "is_active");
CREATE INDEX IF NOT EXISTS "fin_email_sources_user_id_active_idx"
  ON "fin_email_sources"("user_id", "is_active");
CREATE INDEX IF NOT EXISTS "fin_transactions_account_id_date_idx"
  ON "fin_transactions"("account_id", "transaction_date");
CREATE INDEX IF NOT EXISTS "fin_transactions_card_id_date_idx"
  ON "fin_transactions"("card_id", "transaction_date");
CREATE INDEX IF NOT EXISTS "fin_transactions_user_id_category_idx"
  ON "fin_transactions"("user_id", "category_id");
CREATE INDEX IF NOT EXISTS "fin_transactions_user_id_date_idx"
  ON "fin_transactions"("user_id", "transaction_date");
CREATE INDEX IF NOT EXISTS "fin_transactions_transfer_group_id_idx"
  ON "fin_transactions"("transfer_group_id");
CREATE INDEX IF NOT EXISTS "fin_budgets_user_period_idx"
  ON "fin_budgets"("user_id", "period_type", "period_start");
CREATE INDEX IF NOT EXISTS "fin_institutions_user_id_active_idx"
  ON "fin_institutions"("user_id", "is_active");
CREATE INDEX IF NOT EXISTS "fin_institutions_user_id_name_idx"
  ON "fin_institutions"("user_id", "name");
CREATE INDEX IF NOT EXISTS "fin_cards_user_id_institution_id_idx"
  ON "fin_cards"("user_id", "institution_id");
CREATE INDEX IF NOT EXISTS "fin_cards_user_id_active_idx"
  ON "fin_cards"("user_id", "is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "fin_card_balances_card_id_currency_key"
  ON "fin_card_balances"("card_id", "currency");
CREATE INDEX IF NOT EXISTS "fin_savings_goals_user_id_completed_idx"
  ON "fin_savings_goals"("user_id", "is_completed");
CREATE INDEX IF NOT EXISTS "fin_loans_user_id_active_due_idx"
  ON "fin_loans"("user_id", "is_active", "next_due_date");
CREATE INDEX IF NOT EXISTS "fin_receivables_user_status_idx"
  ON "fin_receivables"("user_id", "status");
CREATE INDEX IF NOT EXISTS "fin_email_sync_logs_source_started_idx"
  ON "fin_email_sync_logs"("source_id", "started_at");
CREATE INDEX IF NOT EXISTS "fin_exchange_rates_from_to_idx"
  ON "fin_exchange_rates"("from_currency", "to_currency");
CREATE UNIQUE INDEX IF NOT EXISTS "fin_exchange_rates_from_to_date_key"
  ON "fin_exchange_rates"("from_currency", "to_currency", "rate_date");

-- ── Rebuild FKs with explicit ON DELETE ─────────────────────────────────────

-- user_modules
ALTER TABLE "user_modules" DROP CONSTRAINT IF EXISTS "user_modules_module_id_fkey";
ALTER TABLE "user_modules"
  ADD CONSTRAINT "user_modules_module_id_fkey"
  FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "user_modules" DROP CONSTRAINT IF EXISTS "user_modules_user_id_fkey";
ALTER TABLE "user_modules"
  ADD CONSTRAINT "user_modules_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ai_agent_sessions
ALTER TABLE "ai_agent_sessions" DROP CONSTRAINT IF EXISTS "ai_agent_sessions_module_id_fkey";
ALTER TABLE "ai_agent_sessions"
  ADD CONSTRAINT "ai_agent_sessions_module_id_fkey"
  FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "ai_agent_sessions" DROP CONSTRAINT IF EXISTS "ai_agent_sessions_user_id_fkey";
ALTER TABLE "ai_agent_sessions"
  ADD CONSTRAINT "ai_agent_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ai_messages
ALTER TABLE "ai_messages" DROP CONSTRAINT IF EXISTS "ai_messages_session_id_fkey";
ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "ai_agent_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ai_actions
ALTER TABLE "ai_actions" DROP CONSTRAINT IF EXISTS "ai_actions_message_id_fkey";
ALTER TABLE "ai_actions"
  ADD CONSTRAINT "ai_actions_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "ai_actions" DROP CONSTRAINT IF EXISTS "ai_actions_session_id_fkey";
ALTER TABLE "ai_actions"
  ADD CONSTRAINT "ai_actions_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "ai_agent_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- notifications / push_tokens
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_user_id_fkey";
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "push_tokens" DROP CONSTRAINT IF EXISTS "push_tokens_user_id_fkey";
ALTER TABLE "push_tokens"
  ADD CONSTRAINT "push_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- fin_accounts
ALTER TABLE "fin_accounts" DROP CONSTRAINT IF EXISTS "fin_accounts_user_id_fkey";
ALTER TABLE "fin_accounts"
  ADD CONSTRAINT "fin_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "fin_accounts" DROP CONSTRAINT IF EXISTS "fin_accounts_institution_id_fkey";
ALTER TABLE "fin_accounts"
  ADD CONSTRAINT "fin_accounts_institution_id_fkey"
  FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- fin_email_sources
ALTER TABLE "fin_email_sources" DROP CONSTRAINT IF EXISTS "fin_email_sources_account_id_fkey";
ALTER TABLE "fin_email_sources"
  ADD CONSTRAINT "fin_email_sources_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "fin_email_sources" DROP CONSTRAINT IF EXISTS "fin_email_sources_card_id_fkey";
ALTER TABLE "fin_email_sources"
  ADD CONSTRAINT "fin_email_sources_card_id_fkey"
  FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "fin_email_sources" DROP CONSTRAINT IF EXISTS "fin_email_sources_user_id_fkey";
ALTER TABLE "fin_email_sources"
  ADD CONSTRAINT "fin_email_sources_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- fin_transactions
ALTER TABLE "fin_transactions" DROP CONSTRAINT IF EXISTS "fin_transactions_account_id_fkey";
ALTER TABLE "fin_transactions"
  ADD CONSTRAINT "fin_transactions_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "fin_transactions" DROP CONSTRAINT IF EXISTS "fin_transactions_card_id_fkey";
ALTER TABLE "fin_transactions"
  ADD CONSTRAINT "fin_transactions_card_id_fkey"
  FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "fin_transactions" DROP CONSTRAINT IF EXISTS "fin_transactions_category_id_fkey";
ALTER TABLE "fin_transactions"
  ADD CONSTRAINT "fin_transactions_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "fin_transactions" DROP CONSTRAINT IF EXISTS "fin_transactions_user_id_fkey";
ALTER TABLE "fin_transactions"
  ADD CONSTRAINT "fin_transactions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- fin_categories
ALTER TABLE "fin_categories" DROP CONSTRAINT IF EXISTS "fin_categories_parent_id_fkey";
ALTER TABLE "fin_categories"
  ADD CONSTRAINT "fin_categories_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "fin_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "fin_categories" DROP CONSTRAINT IF EXISTS "fin_categories_user_id_fkey";
ALTER TABLE "fin_categories"
  ADD CONSTRAINT "fin_categories_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- fin_budgets
ALTER TABLE "fin_budgets" DROP CONSTRAINT IF EXISTS "fin_budgets_category_id_fkey";
ALTER TABLE "fin_budgets"
  ADD CONSTRAINT "fin_budgets_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "fin_budgets" DROP CONSTRAINT IF EXISTS "fin_budgets_user_id_fkey";
ALTER TABLE "fin_budgets"
  ADD CONSTRAINT "fin_budgets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "fin_budget_alerts" DROP CONSTRAINT IF EXISTS "fin_budget_alerts_budget_id_fkey";
ALTER TABLE "fin_budget_alerts"
  ADD CONSTRAINT "fin_budget_alerts_budget_id_fkey"
  FOREIGN KEY ("budget_id") REFERENCES "fin_budgets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- fin_recurring_patterns
ALTER TABLE "fin_recurring_patterns" DROP CONSTRAINT IF EXISTS "fin_recurring_patterns_category_fkey";
ALTER TABLE "fin_recurring_patterns"
  ADD CONSTRAINT "fin_recurring_patterns_category_fkey"
  FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "fin_recurring_patterns" DROP CONSTRAINT IF EXISTS "fin_recurring_patterns_user_id_fkey";
ALTER TABLE "fin_recurring_patterns"
  ADD CONSTRAINT "fin_recurring_patterns_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- fin_institutions
ALTER TABLE "fin_institutions" DROP CONSTRAINT IF EXISTS "fin_institutions_user_id_fkey";
ALTER TABLE "fin_institutions"
  ADD CONSTRAINT "fin_institutions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- fin_cards
ALTER TABLE "fin_cards" DROP CONSTRAINT IF EXISTS "fin_cards_account_id_fkey";
ALTER TABLE "fin_cards"
  ADD CONSTRAINT "fin_cards_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "fin_cards" DROP CONSTRAINT IF EXISTS "fin_cards_institution_id_fkey";
ALTER TABLE "fin_cards"
  ADD CONSTRAINT "fin_cards_institution_id_fkey"
  FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "fin_cards" DROP CONSTRAINT IF EXISTS "fin_cards_user_id_fkey";
ALTER TABLE "fin_cards"
  ADD CONSTRAINT "fin_cards_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "fin_card_balances" DROP CONSTRAINT IF EXISTS "fin_card_balances_card_id_fkey";
ALTER TABLE "fin_card_balances"
  ADD CONSTRAINT "fin_card_balances_card_id_fkey"
  FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "fin_savings_goals" DROP CONSTRAINT IF EXISTS "fin_savings_goals_user_id_fkey";
ALTER TABLE "fin_savings_goals"
  ADD CONSTRAINT "fin_savings_goals_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "fin_loans" DROP CONSTRAINT IF EXISTS "fin_loans_account_id_fkey";
ALTER TABLE "fin_loans"
  ADD CONSTRAINT "fin_loans_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "fin_loans" DROP CONSTRAINT IF EXISTS "fin_loans_user_id_fkey";
ALTER TABLE "fin_loans"
  ADD CONSTRAINT "fin_loans_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "fin_receivables" DROP CONSTRAINT IF EXISTS "fin_receivables_user_id_fkey";
ALTER TABLE "fin_receivables"
  ADD CONSTRAINT "fin_receivables_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "fin_email_sync_logs" DROP CONSTRAINT IF EXISTS "fin_email_sync_logs_source_id_fkey";
ALTER TABLE "fin_email_sync_logs"
  ADD CONSTRAINT "fin_email_sync_logs_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "fin_email_sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ── Hardened RLS ─────────────────────────────────────────────────────────────
-- Service role / Prisma bypasses RLS; policies protect PostgREST and direct client access.

-- Drop legacy policies (names from supabase-rls-policies.csv)
DROP POLICY IF EXISTS "ai_actions: own sessions" ON "ai_actions";
DROP POLICY IF EXISTS "ai_sessions: own" ON "ai_agent_sessions";
DROP POLICY IF EXISTS "ai_messages: own sessions" ON "ai_messages";
DROP POLICY IF EXISTS "fin_accounts: own" ON "fin_accounts";
DROP POLICY IF EXISTS "fin_budget_alerts: own budgets" ON "fin_budget_alerts";
DROP POLICY IF EXISTS "fin_budgets: own" ON "fin_budgets";
DROP POLICY IF EXISTS "fin_card_balances: own cards" ON "fin_card_balances";
DROP POLICY IF EXISTS "fin_cards: own" ON "fin_cards";
DROP POLICY IF EXISTS "fin_categories: own or system" ON "fin_categories";
DROP POLICY IF EXISTS "fin_email_sources: own" ON "fin_email_sources";
DROP POLICY IF EXISTS "fin_email_sync_logs: own sources" ON "fin_email_sync_logs";
DROP POLICY IF EXISTS "fin_exchange_rates: public read" ON "fin_exchange_rates";
DROP POLICY IF EXISTS "fin_institutions: own" ON "fin_institutions";
DROP POLICY IF EXISTS "fin_loans: own" ON "fin_loans";
DROP POLICY IF EXISTS "fin_receivables: own" ON "fin_receivables";
DROP POLICY IF EXISTS "fin_recurring: own" ON "fin_recurring_patterns";
DROP POLICY IF EXISTS "fin_savings_goals: own" ON "fin_savings_goals";
DROP POLICY IF EXISTS "fin_transactions: own" ON "fin_transactions";
DROP POLICY IF EXISTS "modules: public read" ON "modules";
DROP POLICY IF EXISTS "notifications: own" ON "notifications";
DROP POLICY IF EXISTS "push_tokens: own" ON "push_tokens";
DROP POLICY IF EXISTS "user_modules: own" ON "user_modules";
DROP POLICY IF EXISTS "users: own row" ON "users";

-- Ensure RLS enabled
ALTER TABLE "ai_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_agent_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_deletion_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_budget_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_card_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_email_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_email_sync_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_exchange_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_institutions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_loans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_receivables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_recurring_patterns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_savings_goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
-- auth_deletion_outbox: RLS on, no user policies (service-only)

CREATE POLICY "users_select_own" ON "users"
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid())::text);
CREATE POLICY "users_update_own" ON "users"
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid())::text)
  WITH CHECK (id = (SELECT auth.uid())::text);

CREATE POLICY "user_modules_all_own" ON "user_modules"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "modules_select_public" ON "modules"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "ai_sessions_all_own" ON "ai_agent_sessions"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "ai_messages_all_own" ON "ai_messages"
  FOR ALL TO authenticated
  USING (
    session_id IN (
      SELECT s.id FROM ai_agent_sessions s
      WHERE s.user_id = (SELECT auth.uid())::text
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT s.id FROM ai_agent_sessions s
      WHERE s.user_id = (SELECT auth.uid())::text
    )
  );

CREATE POLICY "ai_actions_all_own" ON "ai_actions"
  FOR ALL TO authenticated
  USING (
    session_id IN (
      SELECT s.id FROM ai_agent_sessions s
      WHERE s.user_id = (SELECT auth.uid())::text
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT s.id FROM ai_agent_sessions s
      WHERE s.user_id = (SELECT auth.uid())::text
    )
  );

CREATE POLICY "notifications_all_own" ON "notifications"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "push_tokens_all_own" ON "push_tokens"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "fin_accounts_all_own" ON "fin_accounts"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "fin_institutions_all_own" ON "fin_institutions"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "fin_cards_all_own" ON "fin_cards"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "fin_card_balances_all_own" ON "fin_card_balances"
  FOR ALL TO authenticated
  USING (
    card_id IN (
      SELECT c.id FROM fin_cards c
      WHERE c.user_id = (SELECT auth.uid())::text
    )
  )
  WITH CHECK (
    card_id IN (
      SELECT c.id FROM fin_cards c
      WHERE c.user_id = (SELECT auth.uid())::text
    )
  );

CREATE POLICY "fin_transactions_all_own" ON "fin_transactions"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "fin_categories_select_own_or_system" ON "fin_categories"
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())::text OR is_system = true);

CREATE POLICY "fin_categories_insert_own" ON "fin_categories"
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())::text AND is_system = false);

CREATE POLICY "fin_categories_update_own" ON "fin_categories"
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())::text AND is_system = false)
  WITH CHECK (user_id = (SELECT auth.uid())::text AND is_system = false);

CREATE POLICY "fin_categories_delete_own" ON "fin_categories"
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid())::text AND is_system = false);

CREATE POLICY "fin_budgets_all_own" ON "fin_budgets"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "fin_budget_alerts_all_own" ON "fin_budget_alerts"
  FOR ALL TO authenticated
  USING (
    budget_id IN (
      SELECT b.id FROM fin_budgets b
      WHERE b.user_id = (SELECT auth.uid())::text
    )
  )
  WITH CHECK (
    budget_id IN (
      SELECT b.id FROM fin_budgets b
      WHERE b.user_id = (SELECT auth.uid())::text
    )
  );

CREATE POLICY "fin_email_sources_all_own" ON "fin_email_sources"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "fin_email_sync_logs_all_own" ON "fin_email_sync_logs"
  FOR ALL TO authenticated
  USING (
    source_id IN (
      SELECT s.id FROM fin_email_sources s
      WHERE s.user_id = (SELECT auth.uid())::text
    )
  )
  WITH CHECK (
    source_id IN (
      SELECT s.id FROM fin_email_sources s
      WHERE s.user_id = (SELECT auth.uid())::text
    )
  );

CREATE POLICY "fin_exchange_rates_select_public" ON "fin_exchange_rates"
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "fin_loans_all_own" ON "fin_loans"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "fin_receivables_all_own" ON "fin_receivables"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "fin_recurring_all_own" ON "fin_recurring_patterns"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE POLICY "fin_savings_goals_all_own" ON "fin_savings_goals"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);
