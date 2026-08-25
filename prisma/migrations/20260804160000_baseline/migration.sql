-- Baseline migration matching prisma/schema.prisma (empty DB)
-- On populated staging/production: prisma migrate resolve --applied 20260804160000_baseline (do NOT re-run this SQL).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AiRole" AS ENUM ('user', 'assistant', 'tool');

-- CreateEnum
CREATE TYPE "AiActionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "FinAccountType" AS ENUM ('CHECKING', 'SAVINGS', 'CASH', 'INVESTMENT');

-- CreateEnum
CREATE TYPE "FinCardType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "FinCardNetwork" AS ENUM ('VISA', 'MASTERCARD', 'AMEX', 'DISCOVER', 'OTHER');

-- CreateEnum
CREATE TYPE "FinTransactionType" AS ENUM ('DEBIT', 'CREDIT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "FinTransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FinTransactionSource" AS ENUM ('MANUAL', 'EMAIL', 'AI');

-- CreateEnum
CREATE TYPE "FinBudgetPeriodType" AS ENUM ('MONTHLY', 'BIWEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "FinInstallmentFreq" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "FinReceivableStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FinEmailSyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "AiSuggestionStatus" AS ENUM ('NONE', 'PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Santo_Domingo',
    "locale" TEXT NOT NULL DEFAULT 'es-DO',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_modules" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_sessions" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "module_id" TEXT,
    "context_type" TEXT NOT NULL DEFAULT 'general',
    "memory_snapshot" JSONB NOT NULL DEFAULT '{}',
    "last_active_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "session_id" TEXT NOT NULL,
    "role" "AiRole" NOT NULL,
    "content" TEXT NOT NULL,
    "client_message_id" TEXT,
    "tool_calls" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_actions" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "session_id" TEXT NOT NULL,
    "message_id" TEXT,
    "action_type" TEXT NOT NULL,
    "target_module" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AiActionStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "executed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "scheduled_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_accounts" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "institution_id" TEXT,
    "name" TEXT NOT NULL,
    "type" "FinAccountType" NOT NULL,
    "institution" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL(15,2),
    "statement_closing_day" INTEGER,
    "payment_due_day" INTEGER,
    "color" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_email_sources" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT,
    "provider" TEXT NOT NULL,
    "email_address" TEXT NOT NULL,
    "bank_domain" TEXT NOT NULL,
    "label" TEXT,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "imap_host" TEXT,
    "token_expires_at" TIMESTAMPTZ(6),
    "last_synced_at" TIMESTAMPTZ(6),
    "last_message_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_email_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_transactions" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "account_id" TEXT,
    "card_id" TEXT,
    "user_id" TEXT NOT NULL,
    "category_id" TEXT,
    "email_message_id" TEXT,
    "type" "FinTransactionType" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "amount_base_currency" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "exchange_rate" DECIMAL(10,6) NOT NULL DEFAULT 1,
    "merchant" TEXT,
    "description" TEXT,
    "transaction_date" TIMESTAMPTZ(6) NOT NULL,
    "transfer_group_id" TEXT,
    "status" "FinTransactionStatus" NOT NULL DEFAULT 'CONFIRMED',
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "ai_metadata" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "source" "FinTransactionSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_categories" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "parent_id" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "fin_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_budgets" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "period_type" "FinBudgetPeriodType" NOT NULL DEFAULT 'MONTHLY',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount_limit" DECIMAL(15,2) NOT NULL,
    "amount_spent" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "alert_threshold_pct" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "ai_suggestion_status" "AiSuggestionStatus" NOT NULL DEFAULT 'NONE',
    "ai_suggestion_payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_budget_alerts" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "budget_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "pct_used" DECIMAL(5,2) NOT NULL,
    "was_notified" BOOLEAN NOT NULL DEFAULT false,
    "triggered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_budget_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_recurring_patterns" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "category_id" TEXT,
    "merchant" TEXT NOT NULL,
    "avg_amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "frequency" TEXT NOT NULL,
    "next_expected_date" DATE NOT NULL,
    "confidence_score" INTEGER NOT NULL DEFAULT 0,
    "ai_analysis" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_recurring_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_exchange_rates" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "from_currency" TEXT NOT NULL,
    "to_currency" TEXT NOT NULL,
    "rate" DECIMAL(15,6) NOT NULL,
    "rate_date" DATE NOT NULL,

    CONSTRAINT "fin_exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_institutions" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "logo_url" TEXT,
    "country" TEXT NOT NULL DEFAULT 'DO',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_cards" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "account_id" TEXT,
    "name" TEXT NOT NULL,
    "last_four" CHAR(4),
    "type" "FinCardType" NOT NULL,
    "network" "FinCardNetwork",
    "statement_closing_day" INTEGER,
    "payment_due_day" INTEGER,
    "color" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_card_balances" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "card_id" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL(15,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_card_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_savings_goals" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "target_amount" DECIMAL(15,2) NOT NULL,
    "current_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'DOP',
    "target_date" DATE,
    "icon" TEXT,
    "color" TEXT,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_savings_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_loans" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT,
    "lender_name" TEXT NOT NULL,
    "original_amount" DECIMAL(15,2) NOT NULL,
    "current_balance" DECIMAL(15,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'DOP',
    "installment_amount" DECIMAL(15,2) NOT NULL,
    "installment_freq" "FinInstallmentFreq" NOT NULL,
    "total_installments" INTEGER NOT NULL,
    "paid_installments" INTEGER NOT NULL DEFAULT 0,
    "next_due_date" DATE NOT NULL,
    "interest_rate" DECIMAL(5,4),
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_receivables" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "debtor_name" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "paid_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'DOP',
    "due_date" DATE,
    "status" "FinReceivableStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_email_sync_logs" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "source_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "emails_scanned" INTEGER NOT NULL DEFAULT 0,
    "transactions_new" INTEGER NOT NULL DEFAULT 0,
    "status" "FinEmailSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,

    CONSTRAINT "fin_email_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "modules_slug_key" ON "modules"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "modules_key_key" ON "modules"("key");

-- CreateIndex
CREATE UNIQUE INDEX "user_modules_user_id_module_id_key" ON "user_modules"("user_id", "module_id");

-- CreateIndex
CREATE INDEX "ai_agent_sessions_user_id_last_active_idx" ON "ai_agent_sessions"("user_id", "last_active_at");

-- CreateIndex
CREATE INDEX "ai_messages_session_id_client_message_id_idx" ON "ai_messages"("session_id", "client_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_session_id_role_client_message_id_key" ON "ai_messages"("session_id", "role", "client_message_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_scheduled_at_idx" ON "notifications"("scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "fin_accounts_user_id_active_idx" ON "fin_accounts"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "fin_email_sources_user_id_active_idx" ON "fin_email_sources"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "fin_transactions_email_message_id_key" ON "fin_transactions"("email_message_id");

-- CreateIndex
CREATE INDEX "fin_transactions_account_id_date_idx" ON "fin_transactions"("account_id", "transaction_date");

-- CreateIndex
CREATE INDEX "fin_transactions_card_id_date_idx" ON "fin_transactions"("card_id", "transaction_date");

-- CreateIndex
CREATE INDEX "fin_transactions_user_id_category_idx" ON "fin_transactions"("user_id", "category_id");

-- CreateIndex
CREATE INDEX "fin_transactions_user_id_date_idx" ON "fin_transactions"("user_id", "transaction_date");

-- CreateIndex
CREATE INDEX "fin_transactions_transfer_group_id_idx" ON "fin_transactions"("transfer_group_id");

-- CreateIndex
CREATE INDEX "fin_budgets_user_period_idx" ON "fin_budgets"("user_id", "period_type", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "fin_budgets_user_category_period_key" ON "fin_budgets"("user_id", "category_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "fin_exchange_rates_from_to_idx" ON "fin_exchange_rates"("from_currency", "to_currency");

-- CreateIndex
CREATE UNIQUE INDEX "fin_exchange_rates_from_to_date_key" ON "fin_exchange_rates"("from_currency", "to_currency", "rate_date");

-- CreateIndex
CREATE INDEX "fin_institutions_user_id_active_idx" ON "fin_institutions"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "fin_institutions_user_id_name_idx" ON "fin_institutions"("user_id", "name");

-- CreateIndex
CREATE INDEX "fin_cards_user_id_institution_id_idx" ON "fin_cards"("user_id", "institution_id");

-- CreateIndex
CREATE INDEX "fin_cards_user_id_active_idx" ON "fin_cards"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "fin_card_balances_card_id_currency_key" ON "fin_card_balances"("card_id", "currency");

-- CreateIndex
CREATE INDEX "fin_savings_goals_user_id_completed_idx" ON "fin_savings_goals"("user_id", "is_completed");

-- CreateIndex
CREATE INDEX "fin_loans_user_id_active_due_idx" ON "fin_loans"("user_id", "is_active", "next_due_date");

-- CreateIndex
CREATE INDEX "fin_receivables_user_status_idx" ON "fin_receivables"("user_id", "status");

-- CreateIndex
CREATE INDEX "fin_email_sync_logs_source_started_idx" ON "fin_email_sync_logs"("source_id", "started_at");

-- AddForeignKey
ALTER TABLE "user_modules" ADD CONSTRAINT "user_modules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_modules" ADD CONSTRAINT "user_modules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_agent_sessions" ADD CONSTRAINT "ai_agent_sessions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_agent_sessions" ADD CONSTRAINT "ai_agent_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_agent_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_agent_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_accounts" ADD CONSTRAINT "fin_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_accounts" ADD CONSTRAINT "fin_accounts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_email_sources" ADD CONSTRAINT "fin_email_sources_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_email_sources" ADD CONSTRAINT "fin_email_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_categories" ADD CONSTRAINT "fin_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "fin_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_categories" ADD CONSTRAINT "fin_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_budgets" ADD CONSTRAINT "fin_budgets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_budgets" ADD CONSTRAINT "fin_budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_budget_alerts" ADD CONSTRAINT "fin_budget_alerts_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "fin_budgets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_recurring_patterns" ADD CONSTRAINT "fin_recurring_patterns_category_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_recurring_patterns" ADD CONSTRAINT "fin_recurring_patterns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_institutions" ADD CONSTRAINT "fin_institutions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_cards" ADD CONSTRAINT "fin_cards_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_cards" ADD CONSTRAINT "fin_cards_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_cards" ADD CONSTRAINT "fin_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_card_balances" ADD CONSTRAINT "fin_card_balances_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_savings_goals" ADD CONSTRAINT "fin_savings_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_receivables" ADD CONSTRAINT "fin_receivables_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_email_sync_logs" ADD CONSTRAINT "fin_email_sync_logs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "fin_email_sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

