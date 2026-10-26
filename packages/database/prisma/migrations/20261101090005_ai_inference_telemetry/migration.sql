-- Created on 2026-10-24. Keep ordered after the AI-0 baseline in DEV.
-- Telemetry contains operational metadata only; never prompt or response text.

CREATE TYPE "ai_inference_status" AS ENUM ('SUCCEEDED', 'FAILED');

CREATE TABLE "ai_inferences" (
    "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "source_type" TEXT,
    "source_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "input_fingerprint" TEXT NOT NULL,
    "fingerprint_version" TEXT NOT NULL,
    "status" "ai_inference_status" NOT NULL,
    "error_code" TEXT,
    "fallback_count" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_inferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_inferences_fallback_count_nonnegative" CHECK ("fallback_count" >= 0),
    CONSTRAINT "ai_inferences_latency_nonnegative" CHECK ("latency_ms" >= 0),
    CONSTRAINT "ai_inferences_input_tokens_nonnegative" CHECK ("input_tokens" IS NULL OR "input_tokens" >= 0),
    CONSTRAINT "ai_inferences_output_tokens_nonnegative" CHECK ("output_tokens" IS NULL OR "output_tokens" >= 0),
    CONSTRAINT "ai_inferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "ai_inferences_user_created_at_idx" ON "ai_inferences"("user_id", "created_at");
CREATE INDEX "ai_inferences_expires_at_idx" ON "ai_inferences"("expires_at");

ALTER TABLE "ai_inferences" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ai_inferences" FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.ai_inferences FROM %I', role_name);
    END IF;
  END LOOP;
END;
$$;
