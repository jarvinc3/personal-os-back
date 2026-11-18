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
