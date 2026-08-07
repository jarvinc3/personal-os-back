-- Finance hexagonal: ledger amounts, status expansion, domain outbox

-- ── Transaction status enum ──────────────────────────────────
ALTER TYPE "FinTransactionStatus" ADD VALUE IF NOT EXISTS 'DECLINED';
ALTER TYPE "FinTransactionStatus" ADD VALUE IF NOT EXISTS 'REVERSED';

-- ── Ledger amount columns (additive + backfill) ──────────────
ALTER TABLE "fin_transactions"
  ADD COLUMN IF NOT EXISTS "ledger_amount" DECIMAL(15, 2),
  ADD COLUMN IF NOT EXISTS "ledger_currency" TEXT,
  ADD COLUMN IF NOT EXISTS "linked_transaction_id" TEXT;

UPDATE "fin_transactions"
SET
  "ledger_amount" = "amount",
  "ledger_currency" = "currency"
WHERE "ledger_amount" IS NULL OR "ledger_currency" IS NULL;

ALTER TABLE "fin_transactions"
  ALTER COLUMN "ledger_amount" SET NOT NULL,
  ALTER COLUMN "ledger_currency" SET NOT NULL,
  ALTER COLUMN "ledger_currency" SET DEFAULT 'DOP';

-- Widen exchange_rate precision for FX
ALTER TABLE "fin_transactions"
  ALTER COLUMN "exchange_rate" TYPE DECIMAL(18, 8);

CREATE INDEX IF NOT EXISTS "fin_transactions_user_status_date_idx"
  ON "fin_transactions"("user_id", "status", "transaction_date");

CREATE INDEX IF NOT EXISTS "fin_transactions_linked_transaction_id_idx"
  ON "fin_transactions"("linked_transaction_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_transactions_linked_transaction_id_fkey'
  ) THEN
    ALTER TABLE "fin_transactions"
      ADD CONSTRAINT "fin_transactions_linked_transaction_id_fkey"
      FOREIGN KEY ("linked_transaction_id") REFERENCES "fin_transactions"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- ── Budget alert dedupe ──────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "fin_budget_alerts_budget_id_type_key"
  ON "fin_budget_alerts"("budget_id", "type");

-- ── Domain event outbox ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "domain_event_outbox_status" AS ENUM (
    'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "domain_event_outbox" (
  "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
  "event_id" TEXT NOT NULL,
  "event_name" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "user_id" TEXT,
  "payload" JSONB NOT NULL,
  "status" "domain_event_outbox_status" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "processed_at" TIMESTAMPTZ(6),
  CONSTRAINT "domain_event_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "domain_event_outbox_event_id_key"
  ON "domain_event_outbox"("event_id");
CREATE INDEX IF NOT EXISTS "domain_event_outbox_status_next_attempt_idx"
  ON "domain_event_outbox"("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "domain_event_outbox_user_id_idx"
  ON "domain_event_outbox"("user_id");

CREATE TABLE IF NOT EXISTS "processed_domain_events" (
  "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
  "event_id" TEXT NOT NULL,
  "consumer" TEXT NOT NULL,
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "processed_domain_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "processed_domain_events_event_consumer_key"
  ON "processed_domain_events"("event_id", "consumer");

-- Service-role only (RLS on, no user policies)
ALTER TABLE "domain_event_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processed_domain_events" ENABLE ROW LEVEL SECURITY;
