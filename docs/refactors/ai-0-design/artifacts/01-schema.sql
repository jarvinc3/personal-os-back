-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "fin_operation_leg_role" AS ENUM ('SOURCE', 'DESTINATION', 'FEE');

-- CreateEnum
CREATE TYPE "fin_transfer_rail" AS ENUM ('SAME_BANK', 'ACH', 'LBTR', 'OTHER');

-- CreateEnum
CREATE TYPE "fin_budget_rollover" AS ENUM ('NONE', 'SURPLUS', 'SURPLUS_AND_DEFICIT');

-- CreateEnum
CREATE TYPE "fin_card_statement_status" AS ENUM ('OPEN', 'CLOSED', 'PARTIAL', 'MINIMUM_PAID', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "fin_amount_source" AS ENUM ('IMPORTED', 'ESTIMATED', 'MANUAL');

-- CreateEnum
CREATE TYPE "fin_goal_mode" AS ENUM ('EARMARK', 'DEDICATED');

-- CreateEnum
CREATE TYPE "fin_allocation_kind" AS ENUM ('CONTRIBUTION', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "fin_installment_status" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "fin_rate_type" AS ENUM ('FIXED', 'VARIABLE');

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
CREATE TYPE "FinTransactionType" AS ENUM ('DEBIT', 'CREDIT', 'TRANSFER', 'ADJUSTMENT', 'CARD_PAYMENT');

-- CreateEnum
CREATE TYPE "FinCategoryType" AS ENUM ('EXPENSE', 'INCOME');

-- CreateEnum
CREATE TYPE "fin_merchant_category_source" AS ENUM ('MANUAL', 'LEARNED', 'KEYWORD');

-- CreateEnum
CREATE TYPE "fin_recurring_status" AS ENUM ('SUGGESTED', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "fin_recurring_kind" AS ENUM ('SUBSCRIPTION', 'BILL', 'INCOME', 'OTHER');

-- CreateEnum
CREATE TYPE "fin_billing_cycle" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY');

-- CreateEnum
CREATE TYPE "fin_subscription_status" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "fin_subscription_alert_kind" AS ENUM ('PRICE_INCREASE', 'AMOUNT_MISMATCH', 'TRIAL_ENDING', 'ANNUAL_RENEWAL', 'MISSED_CHARGE');

-- CreateEnum
CREATE TYPE "fin_subscription_payment_source" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "FinTransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'DECLINED', 'REVERSED');

-- CreateEnum
CREATE TYPE "FinTransactionSource" AS ENUM ('MANUAL', 'EMAIL', 'AI');

-- CreateEnum
CREATE TYPE "domain_event_outbox_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "FinBudgetPeriodType" AS ENUM ('MONTHLY', 'BIWEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "FinInstallmentFreq" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "FinReceivableStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "AiSuggestionStatus" AS ENUM ('NONE', 'PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "auth_deletion_outbox_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "fin_statement_line_type" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "fin_statement_import_status" AS ENUM ('PARSING', 'READY', 'APPLIED', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "fin_statement_line_decision" AS ENUM ('MATCH', 'CREATE', 'IGNORE');

-- CreateEnum
CREATE TYPE "fin_reconciliation_adjustment_kind" AS ENUM ('IMPUESTO_DGII', 'COMISION', 'CARGO_PLASTICO', 'INTERES', 'OTRO');

-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Santo_Domingo',
    "locale" TEXT NOT NULL DEFAULT 'es-DO',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "last_seen_release_version" TEXT,
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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_actions" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "origin_type" TEXT NOT NULL DEFAULT 'AGENT',
    "origin_reference" TEXT,
    "user_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "target_module" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AiActionStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "executed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "account_number" TEXT,
    "account_number_last4" TEXT,
    "account_number_hash" TEXT,
    "is_default_for_institution" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "color" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_transactions" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "account_id" TEXT,
    "card_id" TEXT,
    "user_id" TEXT NOT NULL,
    "category_id" TEXT,
    "import_reference" TEXT,
    "external_reference" TEXT,
    "institution_id" TEXT,
    "possible_duplicate_of_id" TEXT,
    "type" "FinTransactionType" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "ledger_amount" DECIMAL(15,2) NOT NULL,
    "amount_base_currency" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "ledger_currency" TEXT NOT NULL DEFAULT 'DOP',
    "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "is_estimated" BOOLEAN NOT NULL DEFAULT false,
    "merchant" TEXT,
    "merchant_id" TEXT,
    "description" TEXT,
    "transaction_date" TIMESTAMPTZ(6) NOT NULL,
    "transfer_group_id" TEXT,
    "linked_transaction_id" TEXT,
    "status" "FinTransactionStatus" NOT NULL DEFAULT 'CONFIRMED',
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "ai_metadata" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "source" "FinTransactionSource" NOT NULL DEFAULT 'MANUAL',
    "leg_role" "fin_operation_leg_role",
    "rail" "fin_transfer_rail",
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
    "system_kind" TEXT,
    "type" "FinCategoryType" NOT NULL DEFAULT 'EXPENSE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_budgets" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "category_id" TEXT,
    "name" TEXT,
    "include_children" BOOLEAN NOT NULL DEFAULT true,
    "rollover" "fin_budget_rollover" NOT NULL DEFAULT 'NONE',
    "carried_over" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "period_type" "FinBudgetPeriodType" NOT NULL DEFAULT 'MONTHLY',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount_limit" DECIMAL(15,2) NOT NULL,
    "amount_spent" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "alert_threshold_pct" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "ai_suggestion_status" "AiSuggestionStatus" NOT NULL DEFAULT 'NONE',
    "ai_suggestion_payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_budget_categories" (
    "budget_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "fin_budget_categories_pkey" PRIMARY KEY ("budget_id","category_id")
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
    "merchant_id" TEXT,
    "merchant" TEXT NOT NULL,
    "avg_amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "frequency" TEXT NOT NULL,
    "next_expected_date" DATE NOT NULL,
    "amount_tolerance" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "status" "fin_recurring_status" NOT NULL DEFAULT 'SUGGESTED',
    "kind" "fin_recurring_kind" NOT NULL DEFAULT 'SUBSCRIPTION',
    "confidence_score" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "ai_analysis" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_recurring_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_merchants" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "category_id" TEXT,
    "category_source" "fin_merchant_category_source",
    "domain" TEXT,
    "logo_path" TEXT,
    "custom_logo_path" TEXT,
    "logo_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_merchant_duplicate_dismissals" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "other_merchant_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_merchant_duplicate_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_merchant_aliases" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "merchant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_merchant_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_subscriptions" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "domain" TEXT,
    "logo_path" TEXT,
    "custom_logo_path" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "billing_cycle" "fin_billing_cycle" NOT NULL,
    "billing_interval" INTEGER NOT NULL DEFAULT 1,
    "anchor_date" DATE NOT NULL,
    "next_billing_date" DATE NOT NULL,
    "trial_ends_at" DATE,
    "status" "fin_subscription_status" NOT NULL DEFAULT 'ACTIVE',
    "paused_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "reminder_days_before" INTEGER NOT NULL DEFAULT 3,
    "last_reminded_for" DATE,
    "card_id" TEXT,
    "account_id" TEXT,
    "category_id" TEXT,
    "manage_url" TEXT,
    "notes" TEXT,
    "source_pattern_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_subscription_payments" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "subscription_id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "source" "fin_subscription_payment_source" NOT NULL DEFAULT 'AUTO',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_subscription_alert_dismissals" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "kind" "fin_subscription_alert_kind" NOT NULL,
    "alert_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_subscription_alert_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_exchange_rates" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "from_currency" TEXT NOT NULL,
    "to_currency" TEXT NOT NULL,
    "rate" DECIMAL(15,6) NOT NULL,
    "rate_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_institutions" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'bank',
    "short_name" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "domain" TEXT,
    "logo_path" TEXT,
    "custom_logo_path" TEXT,
    "logo_url" TEXT,
    "color" TEXT,
    "country" TEXT NOT NULL DEFAULT 'DO',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
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
    "last_four" TEXT,
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
    "currency" TEXT NOT NULL,
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL(15,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_card_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_instrument_events" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT,
    "card_id" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_instrument_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_card_statements" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "card_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "cycle_start" DATE NOT NULL,
    "cycle_end" DATE NOT NULL,
    "due_date" DATE,
    "closing_balance" DECIMAL(15,2) NOT NULL,
    "minimum_payment" DECIMAL(15,2),
    "minimum_source" "fin_amount_source",
    "status" "fin_card_statement_status" NOT NULL DEFAULT 'CLOSED',
    "imported_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_card_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_savings_goals" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "target_amount" DECIMAL(15,2) NOT NULL,
    "current_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "target_date" DATE,
    "icon" TEXT,
    "color" TEXT,
    "account_id" TEXT,
    "mode" "fin_goal_mode" NOT NULL DEFAULT 'EARMARK',
    "spend_reduces_progress" BOOLEAN NOT NULL DEFAULT true,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_savings_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_savings_goal_contributions" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "goal_id" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "contributed_at" DATE NOT NULL,
    "account_id" TEXT,
    "destination_account_id" TEXT,
    "transaction_id" TEXT,
    "kind" "fin_allocation_kind" NOT NULL DEFAULT 'CONTRIBUTION',
    "transfer_group_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_savings_goal_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_loans" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "institution_id" TEXT,
    "account_id" TEXT,
    "name" TEXT,
    "lender_name" TEXT NOT NULL,
    "original_amount" DECIMAL(15,2) NOT NULL,
    "current_balance" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "installment_amount" DECIMAL(15,2) NOT NULL,
    "installment_freq" "FinInstallmentFreq" NOT NULL,
    "total_installments" INTEGER NOT NULL,
    "paid_installments" INTEGER NOT NULL DEFAULT 0,
    "next_due_date" DATE NOT NULL,
    "interest_rate" DECIMAL(5,4),
    "rate_type" "fin_rate_type" NOT NULL DEFAULT 'FIXED',
    "insurance_amount" DECIMAL(15,2),
    "late_fee_policy" JSONB,
    "prepayment_penalty_pct" DECIMAL(5,4),
    "disbursement_date" DATE,
    "disbursement_account_id" TEXT,
    "disbursement_transaction_id" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_loan_installments" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "loan_id" TEXT NOT NULL,
    "installment_no" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "principal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "interest" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "insurance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "fees" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "late_fee" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "fin_installment_status" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ(6),
    "transaction_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_loan_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_loan_prepayments" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "loan_id" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "penalty" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "mode" TEXT NOT NULL,
    "paid_at" DATE NOT NULL,
    "transaction_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_loan_prepayments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_receivables" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "debtor_name" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "paid_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "due_date" DATE,
    "status" "FinReceivableStatus" NOT NULL DEFAULT 'PENDING',
    "credit_balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "written_off_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "written_off_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_receivable_shares" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "debtor_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_receivable_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_receivable_share_items" (
    "share_id" TEXT NOT NULL,
    "receivable_id" TEXT NOT NULL,

    CONSTRAINT "fin_receivable_share_items_pkey" PRIMARY KEY ("share_id","receivable_id")
);

-- CreateTable
CREATE TABLE "fin_receivable_payments" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "receivable_id" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "applied_amount" DECIMAL(15,2) NOT NULL,
    "excess_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "excess_handling" TEXT,
    "paid_at" DATE NOT NULL,
    "account_id" TEXT,
    "transaction_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_receivable_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_event_outbox" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "event_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "user_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" "domain_event_outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "claimed_at" TIMESTAMPTZ(6),

    CONSTRAINT "domain_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_domain_events" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "event_id" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_deletion_outbox" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "status" "auth_deletion_outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_deletion_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_deletion_journal" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "operation_group_id" TEXT,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "restored_at" TIMESTAMPTZ(6),

    CONSTRAINT "fin_deletion_journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_statement_imports" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "card_id" TEXT,
    "account_id" TEXT,
    "statement_id" TEXT,
    "status" "fin_statement_import_status" NOT NULL DEFAULT 'PARSING',
    "parsed" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(6),

    CONSTRAINT "fin_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_statement_import_lines" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "import_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "type" "fin_statement_line_type" NOT NULL,
    "reference" TEXT,
    "category_id" TEXT,
    "transaction_id" TEXT,
    "decision" "fin_statement_line_decision" NOT NULL DEFAULT 'CREATE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_statement_import_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_reconciliations" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT,
    "card_id" TEXT,
    "currency" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "app_balance" DECIMAL(15,2) NOT NULL,
    "real_balance" DECIMAL(15,2) NOT NULL,
    "difference" DECIMAL(15,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_reconciliation_adjustments" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "reconciliation_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "kind" "fin_reconciliation_adjustment_kind" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "fin_reconciliation_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_balance_drifts" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT,
    "card_id" TEXT,
    "currency" TEXT NOT NULL,
    "stored_balance" DECIMAL(15,2) NOT NULL,
    "expected_balance" DECIMAL(15,2) NOT NULL,
    "difference" DECIMAL(15,2) NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "fin_balance_drifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "idempotency_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "modules_slug_key" ON "modules"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "modules_key_key" ON "modules"("key");

-- CreateIndex
CREATE INDEX "user_modules_module_id_idx" ON "user_modules"("module_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_modules_user_id_module_id_key" ON "user_modules"("user_id", "module_id");

-- CreateIndex
CREATE INDEX "ai_actions_user_id_idx" ON "ai_actions"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_scheduled_at_idx" ON "notifications"("scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens"("user_id");

-- CreateIndex
CREATE INDEX "fin_accounts_user_id_active_idx" ON "fin_accounts"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "fin_accounts_institution_id_idx" ON "fin_accounts"("institution_id");

-- CreateIndex
CREATE INDEX "fin_accounts_user_institution_default_idx" ON "fin_accounts"("user_id", "institution_id", "is_default_for_institution");

-- CreateIndex
CREATE UNIQUE INDEX "fin_accounts_user_institution_number_hash_key" ON "fin_accounts"("user_id", "institution_id", "account_number_hash");

-- CreateIndex
CREATE INDEX "fin_transactions_account_id_date_idx" ON "fin_transactions"("account_id", "transaction_date");

-- CreateIndex
CREATE INDEX "fin_transactions_card_id_date_idx" ON "fin_transactions"("card_id", "transaction_date");

-- CreateIndex
CREATE INDEX "fin_transactions_user_id_category_idx" ON "fin_transactions"("user_id", "category_id");

-- CreateIndex
CREATE INDEX "fin_transactions_merchant_id_idx" ON "fin_transactions"("merchant_id");

-- CreateIndex
CREATE INDEX "fin_transactions_user_id_date_idx" ON "fin_transactions"("user_id", "transaction_date");

-- CreateIndex
CREATE INDEX "fin_transactions_user_status_date_idx" ON "fin_transactions"("user_id", "status", "transaction_date");

-- CreateIndex
CREATE INDEX "fin_transactions_user_ref_idx" ON "fin_transactions"("user_id", "external_reference");

-- CreateIndex
CREATE INDEX "fin_transactions_transfer_group_id_idx" ON "fin_transactions"("transfer_group_id");

-- CreateIndex
CREATE INDEX "fin_transactions_category_id_idx" ON "fin_transactions"("category_id");

-- CreateIndex
CREATE INDEX "fin_transactions_linked_transaction_id_idx" ON "fin_transactions"("linked_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_transactions_user_import_reference_key" ON "fin_transactions"("user_id", "import_reference");

-- CreateIndex
CREATE INDEX "fin_categories_user_id_idx" ON "fin_categories"("user_id");

-- CreateIndex
CREATE INDEX "fin_categories_parent_id_idx" ON "fin_categories"("parent_id");

-- CreateIndex
CREATE INDEX "fin_categories_user_id_type_idx" ON "fin_categories"("user_id", "type");

-- CreateIndex
CREATE INDEX "fin_budgets_user_period_idx" ON "fin_budgets"("user_id", "period_type", "period_start");

-- CreateIndex
CREATE INDEX "fin_budgets_category_id_idx" ON "fin_budgets"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_budgets_user_category_period_key" ON "fin_budgets"("user_id", "category_id", "period_start");

-- CreateIndex
CREATE INDEX "fin_budget_categories_category_id_idx" ON "fin_budget_categories"("category_id");

-- CreateIndex
CREATE INDEX "fin_budget_alerts_budget_id_idx" ON "fin_budget_alerts"("budget_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_budget_alerts_budget_id_type_key" ON "fin_budget_alerts"("budget_id", "type");

-- CreateIndex
CREATE INDEX "fin_recurring_patterns_user_id_idx" ON "fin_recurring_patterns"("user_id");

-- CreateIndex
CREATE INDEX "fin_recurring_patterns_category_id_idx" ON "fin_recurring_patterns"("category_id");

-- CreateIndex
CREATE INDEX "fin_recurring_patterns_user_status_idx" ON "fin_recurring_patterns"("user_id", "status");

-- CreateIndex
CREATE INDEX "fin_recurring_patterns_user_next_date_idx" ON "fin_recurring_patterns"("user_id", "next_expected_date");

-- CreateIndex
CREATE INDEX "fin_merchants_user_id_idx" ON "fin_merchants"("user_id");

-- CreateIndex
CREATE INDEX "fin_merchants_category_id_idx" ON "fin_merchants"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_merchants_user_normalized_key_uq" ON "fin_merchants"("user_id", "normalized_key");

-- CreateIndex
CREATE INDEX "fin_merchant_duplicate_dismissals_merchant_id_idx" ON "fin_merchant_duplicate_dismissals"("merchant_id");

-- CreateIndex
CREATE INDEX "fin_merchant_duplicate_dismissals_other_id_idx" ON "fin_merchant_duplicate_dismissals"("other_merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_merchant_duplicate_dismissals_pair_uq" ON "fin_merchant_duplicate_dismissals"("user_id", "merchant_id", "other_merchant_id");

-- CreateIndex
CREATE INDEX "fin_merchant_aliases_merchant_id_idx" ON "fin_merchant_aliases"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_merchant_aliases_user_key_uq" ON "fin_merchant_aliases"("user_id", "normalized_key");

-- CreateIndex
CREATE INDEX "fin_subscriptions_user_status_idx" ON "fin_subscriptions"("user_id", "status");

-- CreateIndex
CREATE INDEX "fin_subscriptions_user_next_billing_idx" ON "fin_subscriptions"("user_id", "next_billing_date");

-- CreateIndex
CREATE INDEX "fin_subscriptions_card_id_idx" ON "fin_subscriptions"("card_id");

-- CreateIndex
CREATE INDEX "fin_subscriptions_account_id_idx" ON "fin_subscriptions"("account_id");

-- CreateIndex
CREATE INDEX "fin_subscriptions_category_id_idx" ON "fin_subscriptions"("category_id");

-- CreateIndex
CREATE INDEX "fin_subscriptions_source_pattern_id_idx" ON "fin_subscriptions"("source_pattern_id");

-- CreateIndex
CREATE INDEX "fin_subscription_payments_sub_paid_idx" ON "fin_subscription_payments"("subscription_id", "paid_at");

-- CreateIndex
CREATE INDEX "fin_subscription_payments_transaction_id_idx" ON "fin_subscription_payments"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_subscription_payments_sub_tx_uq" ON "fin_subscription_payments"("subscription_id", "transaction_id");

-- CreateIndex
CREATE INDEX "fin_subscription_alert_dismissals_user_idx" ON "fin_subscription_alert_dismissals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_subscription_alert_dismissals_uq" ON "fin_subscription_alert_dismissals"("subscription_id", "kind", "alert_date");

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
CREATE INDEX "fin_cards_account_id_idx" ON "fin_cards"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_card_balances_card_id_currency_key" ON "fin_card_balances"("card_id", "currency");

-- CreateIndex
CREATE INDEX "fin_instrument_events_account_created_idx" ON "fin_instrument_events"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "fin_instrument_events_card_created_idx" ON "fin_instrument_events"("card_id", "created_at");

-- CreateIndex
CREATE INDEX "fin_card_statements_card_id_cycle_end_idx" ON "fin_card_statements"("card_id", "cycle_end");

-- CreateIndex
CREATE UNIQUE INDEX "fin_card_statements_card_currency_cycle_key" ON "fin_card_statements"("card_id", "currency", "cycle_end");

-- CreateIndex
CREATE INDEX "fin_savings_goals_user_id_completed_idx" ON "fin_savings_goals"("user_id", "is_completed");

-- CreateIndex
CREATE INDEX "fin_savings_goals_account_id_idx" ON "fin_savings_goals"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_savings_goal_contributions_transaction_id_key" ON "fin_savings_goal_contributions"("transaction_id");

-- CreateIndex
CREATE INDEX "fin_savings_goal_contributions_goal_id_date_idx" ON "fin_savings_goal_contributions"("goal_id", "contributed_at");

-- CreateIndex
CREATE INDEX "fin_savings_goal_contributions_account_id_idx" ON "fin_savings_goal_contributions"("account_id");

-- CreateIndex
CREATE INDEX "fin_savings_goal_contributions_destination_account_id_idx" ON "fin_savings_goal_contributions"("destination_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_loans_disbursement_transaction_id_key" ON "fin_loans"("disbursement_transaction_id");

-- CreateIndex
CREATE INDEX "fin_loans_user_id_active_due_idx" ON "fin_loans"("user_id", "is_active", "next_due_date");

-- CreateIndex
CREATE INDEX "fin_loans_account_id_idx" ON "fin_loans"("account_id");

-- CreateIndex
CREATE INDEX "fin_loans_disbursement_account_id_idx" ON "fin_loans"("disbursement_account_id");

-- CreateIndex
CREATE INDEX "fin_loans_institution_id_idx" ON "fin_loans"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_loan_installments_transaction_id_key" ON "fin_loan_installments"("transaction_id");

-- CreateIndex
CREATE INDEX "fin_loan_installments_loan_id_due_idx" ON "fin_loan_installments"("loan_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "fin_loan_installments_loan_no_key" ON "fin_loan_installments"("loan_id", "installment_no");

-- CreateIndex
CREATE UNIQUE INDEX "fin_loan_prepayments_transaction_id_key" ON "fin_loan_prepayments"("transaction_id");

-- CreateIndex
CREATE INDEX "fin_loan_prepayments_loan_paid_idx" ON "fin_loan_prepayments"("loan_id", "paid_at");

-- CreateIndex
CREATE INDEX "fin_receivables_user_status_idx" ON "fin_receivables"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fin_receivable_shares_token_key" ON "fin_receivable_shares"("token");

-- CreateIndex
CREATE INDEX "fin_receivable_shares_user_id_idx" ON "fin_receivable_shares"("user_id");

-- CreateIndex
CREATE INDEX "fin_receivable_share_items_receivable_id_idx" ON "fin_receivable_share_items"("receivable_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_receivable_payments_transaction_id_key" ON "fin_receivable_payments"("transaction_id");

-- CreateIndex
CREATE INDEX "fin_receivable_payments_receivable_id_paid_at_idx" ON "fin_receivable_payments"("receivable_id", "paid_at");

-- CreateIndex
CREATE INDEX "fin_receivable_payments_account_id_idx" ON "fin_receivable_payments"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "domain_event_outbox_event_id_key" ON "domain_event_outbox"("event_id");

-- CreateIndex
CREATE INDEX "domain_event_outbox_status_next_attempt_idx" ON "domain_event_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "domain_event_outbox_status_claimed_at_idx" ON "domain_event_outbox"("status", "claimed_at");

-- CreateIndex
CREATE INDEX "domain_event_outbox_user_id_idx" ON "domain_event_outbox"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "processed_domain_events_event_consumer_key" ON "processed_domain_events"("event_id", "consumer");

-- CreateIndex
CREATE UNIQUE INDEX "auth_deletion_outbox_user_id_key" ON "auth_deletion_outbox"("user_id");

-- CreateIndex
CREATE INDEX "auth_deletion_outbox_status_next_attempt_idx" ON "auth_deletion_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "fin_deletion_journal_user_entity_idx" ON "fin_deletion_journal"("user_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "fin_deletion_journal_expires_at_idx" ON "fin_deletion_journal"("expires_at");

-- CreateIndex
CREATE INDEX "fin_statement_imports_user_status_idx" ON "fin_statement_imports"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "fin_statement_imports_card_id_idx" ON "fin_statement_imports"("card_id");

-- CreateIndex
CREATE INDEX "fin_statement_imports_account_id_idx" ON "fin_statement_imports"("account_id");

-- CreateIndex
CREATE INDEX "fin_statement_import_lines_import_date_idx" ON "fin_statement_import_lines"("import_id", "date");

-- CreateIndex
CREATE INDEX "fin_statement_import_lines_transaction_idx" ON "fin_statement_import_lines"("transaction_id");

-- CreateIndex
CREATE INDEX "fin_reconciliations_user_account_date_idx" ON "fin_reconciliations"("user_id", "account_id", "as_of_date" DESC);

-- CreateIndex
CREATE INDEX "fin_reconciliations_user_card_date_idx" ON "fin_reconciliations"("user_id", "card_id", "as_of_date" DESC);

-- CreateIndex
CREATE INDEX "fin_reconciliations_account_id_idx" ON "fin_reconciliations"("account_id");

-- CreateIndex
CREATE INDEX "fin_reconciliations_card_id_idx" ON "fin_reconciliations"("card_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_reconciliation_adjustments_transaction_id_key" ON "fin_reconciliation_adjustments"("transaction_id");

-- CreateIndex
CREATE INDEX "fin_reconciliation_adjustments_reconciliation_idx" ON "fin_reconciliation_adjustments"("reconciliation_id");

-- CreateIndex
CREATE INDEX "fin_reconciliation_adjustments_transaction_idx" ON "fin_reconciliation_adjustments"("transaction_id");

-- CreateIndex
CREATE INDEX "fin_balance_drifts_user_resolved_idx" ON "fin_balance_drifts"("user_id", "resolved_at");

-- CreateIndex
CREATE INDEX "fin_balance_drifts_account_resolved_idx" ON "fin_balance_drifts"("account_id", "resolved_at");

-- CreateIndex
CREATE INDEX "fin_balance_drifts_card_resolved_idx" ON "fin_balance_drifts"("card_id", "resolved_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_key_key" ON "idempotency_keys"("user_id", "key");

-- AddForeignKey
ALTER TABLE "user_modules" ADD CONSTRAINT "user_modules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_modules" ADD CONSTRAINT "user_modules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_accounts" ADD CONSTRAINT "fin_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_accounts" ADD CONSTRAINT "fin_accounts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "fin_merchants"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_linked_transaction_id_fkey" FOREIGN KEY ("linked_transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_categories" ADD CONSTRAINT "fin_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "fin_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_categories" ADD CONSTRAINT "fin_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_budgets" ADD CONSTRAINT "fin_budgets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_budgets" ADD CONSTRAINT "fin_budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_budget_categories" ADD CONSTRAINT "fin_budget_categories_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "fin_budgets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_budget_categories" ADD CONSTRAINT "fin_budget_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_budget_alerts" ADD CONSTRAINT "fin_budget_alerts_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "fin_budgets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_recurring_patterns" ADD CONSTRAINT "fin_recurring_patterns_category_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_recurring_patterns" ADD CONSTRAINT "fin_recurring_patterns_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "fin_merchants"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_recurring_patterns" ADD CONSTRAINT "fin_recurring_patterns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_merchants" ADD CONSTRAINT "fin_merchants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_merchants" ADD CONSTRAINT "fin_merchants_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_merchant_duplicate_dismissals" ADD CONSTRAINT "fin_merchant_duplicate_dismissals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_merchant_duplicate_dismissals" ADD CONSTRAINT "fin_merchant_duplicate_dismissals_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "fin_merchants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_merchant_duplicate_dismissals" ADD CONSTRAINT "fin_merchant_duplicate_dismissals_other_merchant_id_fkey" FOREIGN KEY ("other_merchant_id") REFERENCES "fin_merchants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_merchant_aliases" ADD CONSTRAINT "fin_merchant_aliases_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "fin_merchants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_merchant_aliases" ADD CONSTRAINT "fin_merchant_aliases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscriptions" ADD CONSTRAINT "fin_subscriptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscriptions" ADD CONSTRAINT "fin_subscriptions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscriptions" ADD CONSTRAINT "fin_subscriptions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscriptions" ADD CONSTRAINT "fin_subscriptions_source_pattern_id_fkey" FOREIGN KEY ("source_pattern_id") REFERENCES "fin_recurring_patterns"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscriptions" ADD CONSTRAINT "fin_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscription_payments" ADD CONSTRAINT "fin_subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "fin_subscriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscription_payments" ADD CONSTRAINT "fin_subscription_payments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscription_alert_dismissals" ADD CONSTRAINT "fin_subscription_alert_dismissals_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "fin_subscriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_subscription_alert_dismissals" ADD CONSTRAINT "fin_subscription_alert_dismissals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_institutions" ADD CONSTRAINT "fin_institutions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_cards" ADD CONSTRAINT "fin_cards_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_cards" ADD CONSTRAINT "fin_cards_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_cards" ADD CONSTRAINT "fin_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_card_balances" ADD CONSTRAINT "fin_card_balances_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_instrument_events" ADD CONSTRAINT "fin_instrument_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_instrument_events" ADD CONSTRAINT "fin_instrument_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_instrument_events" ADD CONSTRAINT "fin_instrument_events_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_card_statements" ADD CONSTRAINT "fin_card_statements_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_savings_goals" ADD CONSTRAINT "fin_savings_goals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_savings_goals" ADD CONSTRAINT "fin_savings_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_savings_goal_contributions" ADD CONSTRAINT "fin_savings_goal_contributions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_savings_goal_contributions" ADD CONSTRAINT "fin_savings_goal_contributions_destination_account_id_fkey" FOREIGN KEY ("destination_account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_savings_goal_contributions" ADD CONSTRAINT "fin_savings_goal_contributions_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "fin_savings_goals"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_savings_goal_contributions" ADD CONSTRAINT "fin_savings_goal_contributions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_disbursement_account_id_fkey" FOREIGN KEY ("disbursement_account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_disbursement_transaction_id_fkey" FOREIGN KEY ("disbursement_transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_loan_installments" ADD CONSTRAINT "fin_loan_installments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "fin_loans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_loan_installments" ADD CONSTRAINT "fin_loan_installments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_loan_prepayments" ADD CONSTRAINT "fin_loan_prepayments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "fin_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_loan_prepayments" ADD CONSTRAINT "fin_loan_prepayments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_receivables" ADD CONSTRAINT "fin_receivables_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_receivable_shares" ADD CONSTRAINT "fin_receivable_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_receivable_share_items" ADD CONSTRAINT "fin_receivable_share_items_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "fin_receivable_shares"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_receivable_share_items" ADD CONSTRAINT "fin_receivable_share_items_receivable_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "fin_receivables"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_receivable_payments" ADD CONSTRAINT "fin_receivable_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_receivable_payments" ADD CONSTRAINT "fin_receivable_payments_receivable_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "fin_receivables"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_receivable_payments" ADD CONSTRAINT "fin_receivable_payments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_deletion_journal" ADD CONSTRAINT "fin_deletion_journal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_statement_imports" ADD CONSTRAINT "fin_statement_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_statement_imports" ADD CONSTRAINT "fin_statement_imports_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_statement_imports" ADD CONSTRAINT "fin_statement_imports_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_statement_imports" ADD CONSTRAINT "fin_statement_imports_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "fin_card_statements"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_statement_import_lines" ADD CONSTRAINT "fin_statement_import_lines_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "fin_statement_imports"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_statement_import_lines" ADD CONSTRAINT "fin_statement_import_lines_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_reconciliations" ADD CONSTRAINT "fin_reconciliations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_reconciliations" ADD CONSTRAINT "fin_reconciliations_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_reconciliations" ADD CONSTRAINT "fin_reconciliations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_reconciliation_adjustments" ADD CONSTRAINT "fin_reconciliation_adjustments_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "fin_reconciliations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_reconciliation_adjustments" ADD CONSTRAINT "fin_reconciliation_adjustments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_balance_drifts" ADD CONSTRAINT "fin_balance_drifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_balance_drifts" ADD CONSTRAINT "fin_balance_drifts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_balance_drifts" ADD CONSTRAINT "fin_balance_drifts_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
