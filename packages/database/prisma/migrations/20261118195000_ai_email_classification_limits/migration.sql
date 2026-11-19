-- AlterTable
ALTER TABLE "ai_inferences"
  ADD COLUMN "cost_usd" DECIMAL(12, 6);

-- AlterTable
ALTER TABLE "ai_email_connections"
  ADD COLUMN "initial_budget_remaining" INTEGER;

-- CreateTable
CREATE TABLE "ai_email_daily_costs" (
  "date" DATE NOT NULL,
  "cost_usd" DECIMAL(12, 6) NOT NULL DEFAULT 0,
  "alerted_at" TIMESTAMPTZ(6),
  "paused_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_email_daily_costs_pkey" PRIMARY KEY ("date")
);

-- Backfill: las conexiones previas a la columna reciben su carga inicial una vez.
UPDATE "ai_email_connections"
SET "initial_budget_remaining" = 500
WHERE "initial_budget_remaining" IS NULL;

-- Protect the new table like the rest of the schema.
ALTER TABLE "ai_email_daily_costs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ai_email_daily_costs" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "ai_email_daily_costs" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "ai_email_daily_costs" FROM authenticated;
  END IF;
END $$;
