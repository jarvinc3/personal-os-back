-- AI-5: persist message-level proposals, route-level classifications and budget.
ALTER TABLE "ai_email_messages"
  ADD COLUMN "classification" JSONB,
  ADD COLUMN "classification_path" TEXT,
  ADD COLUMN "classification_provider" TEXT,
  ADD COLUMN "classification_model" TEXT;

CREATE TABLE "ai_email_classifications" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "relevance" BOOLEAN NOT NULL,
  "semantic_type" TEXT NOT NULL,
  "transaction" JSONB,
  "confidence" DOUBLE PRECISION NOT NULL,
  "decision_path" TEXT NOT NULL,
  "knowledge_used" JSONB NOT NULL DEFAULT '[]',
  "provider" TEXT,
  "model" TEXT,
  "inference_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_email_classifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_email_classifications_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
  CONSTRAINT "ai_email_classifications_route_check" CHECK ("route" IN ('NONE', 'FINANCE', 'SUBSCRIPTIONS', 'CALENDAR', 'SECURITY')),
  CONSTRAINT "ai_email_classifications_semantic_type_check" CHECK ("semantic_type" IN ('FIN_TRANSACTION', 'PURCHASE_RECEIPT', 'SUBSCRIPTION_BILLING', 'FIN_STATEMENT_NOTICE', 'FIN_ACCOUNT_NOTICE', 'SECURITY_OTP', 'SECURITY_ALERT', 'TECH_NOTIFICATION', 'JOB', 'CALENDAR_EVENT', 'MARKETING', 'SOCIAL', 'OTHER'))
);

CREATE TABLE "ai_email_model_budgets" (
  "user_id" TEXT NOT NULL,
  "budget_date" DATE NOT NULL,
  "calls" INTEGER NOT NULL DEFAULT 0,
  "daily_limit" INTEGER NOT NULL DEFAULT 100,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_email_model_budgets_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "ai_email_model_budgets_calls_check" CHECK ("calls" >= 0),
  CONSTRAINT "ai_email_model_budgets_daily_limit_check" CHECK ("daily_limit" > 0)
);

CREATE UNIQUE INDEX "ai_email_classifications_message_route_key"
  ON "ai_email_classifications"("message_id", "route");
CREATE UNIQUE INDEX "ai_email_messages_id_user_id_key"
  ON "ai_email_messages"("id", "user_id");
CREATE INDEX "ai_email_classifications_user_message_idx"
  ON "ai_email_classifications"("user_id", "message_id", "created_at");

ALTER TABLE "ai_email_classifications" ADD CONSTRAINT "ai_email_classifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ai_email_classifications" ADD CONSTRAINT "ai_email_classifications_message_id_user_id_fkey"
  FOREIGN KEY ("message_id", "user_id") REFERENCES "ai_email_messages"("id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ai_email_model_budgets" ADD CONSTRAINT "ai_email_model_budgets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ai_email_classifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_email_model_budgets" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ai_email_classifications", "ai_email_model_budgets" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "ai_email_classifications", "ai_email_model_budgets" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "ai_email_classifications", "ai_email_model_budgets" FROM authenticated;
  END IF;
END $$;
