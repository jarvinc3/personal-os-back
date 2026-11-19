-- El tope diario por usuario pasa de llamadas a tokens (#402). Los contadores
-- guardados son llamadas, no tokens: se marcan como agotados para no regalar
-- presupuesto el día en curso y el reinicio diario los vuelve a cero.
ALTER TABLE "ai_email_model_budgets" RENAME TO "ai_email_token_budgets";
ALTER TABLE "ai_email_token_budgets" RENAME COLUMN "calls" TO "tokens";
ALTER TABLE "ai_email_token_budgets" RENAME COLUMN "daily_limit" TO "token_limit";
ALTER TABLE "ai_email_token_budgets" ALTER COLUMN "token_limit" SET DEFAULT 320000;
ALTER TABLE "ai_email_token_budgets" RENAME CONSTRAINT "ai_email_model_budgets_pkey" TO "ai_email_token_budgets_pkey";
ALTER TABLE "ai_email_token_budgets" RENAME CONSTRAINT "ai_email_model_budgets_user_id_fkey" TO "ai_email_token_budgets_user_id_fkey";
ALTER TABLE "ai_email_token_budgets" RENAME CONSTRAINT "ai_email_model_budgets_calls_check" TO "ai_email_token_budgets_tokens_check";
ALTER TABLE "ai_email_token_budgets" RENAME CONSTRAINT "ai_email_model_budgets_daily_limit_check" TO "ai_email_token_budgets_token_limit_check";
UPDATE "ai_email_token_budgets" SET "tokens" = "token_limit";

-- Llamadas al proveedor por minuto, compartidas por todas las réplicas.
CREATE TABLE "ai_provider_minutes" (
  "provider" VARCHAR(40) NOT NULL,
  "minute" TIMESTAMPTZ(6) NOT NULL,
  "calls" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_provider_minutes_pkey" PRIMARY KEY ("provider", "minute")
);

-- Protect the new table like the rest of the schema.
ALTER TABLE "ai_provider_minutes" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ai_provider_minutes" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "ai_provider_minutes" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "ai_provider_minutes" FROM authenticated;
  END IF;
END $$;
