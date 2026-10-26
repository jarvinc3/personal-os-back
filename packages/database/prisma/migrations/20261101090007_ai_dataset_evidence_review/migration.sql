-- Creada el 2026-10-25; timestamp posterior a la última migración del repo.
CREATE TYPE "ai_dataset_partition" AS ENUM ('TRAIN', 'VALIDATION', 'HOLDOUT');
CREATE TYPE "ai_analysis_mode" AS ENUM ('ANALYZE_ONLY', 'EVALUATE', 'IMPORT');
CREATE TYPE "ai_analysis_run_status" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "ai_human_verification_verdict" AS ENUM ('CONFIRMED', 'CORRECTED', 'REJECTED');

CREATE TABLE "ai_datasets" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "name" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "source_type" TEXT NOT NULL DEFAULT 'EMAIL',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_datasets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_dataset_items" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "dataset_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "partition" "ai_dataset_partition" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_dataset_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_analysis_runs" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "dataset_id" TEXT NOT NULL,
  "mode" "ai_analysis_mode" NOT NULL DEFAULT 'ANALYZE_ONLY',
  "status" "ai_analysis_run_status" NOT NULL DEFAULT 'RUNNING',
  "observation_sequence" BIGINT NOT NULL DEFAULT 0,
  "verification_sequence" BIGINT NOT NULL DEFAULT 0,
  "projector_version" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "pipeline_version" TEXT NOT NULL,
  "detector_version" TEXT,
  "prompt_version" TEXT,
  "schema_version" TEXT,
  "configuration" JSONB NOT NULL DEFAULT '{}',
  "metrics" JSONB,
  "error" TEXT,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_analysis_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_knowledge_observations" (
  "sequence" BIGSERIAL NOT NULL,
  "run_id" TEXT,
  "user_id" TEXT,
  "knowledge_type" TEXT NOT NULL,
  "knowledge_key" TEXT NOT NULL,
  "proposed_scope" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "inference_id" TEXT,
  "payload" JSONB NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_knowledge_observations_pkey" PRIMARY KEY ("sequence")
);

CREATE TABLE "ai_human_verifications" (
  "sequence" BIGSERIAL NOT NULL,
  "user_id" TEXT NOT NULL,
  "verifier_role" "ai_user_role" NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "verdict" "ai_human_verification_verdict" NOT NULL,
  "corrected_payload" JSONB,
  "notes" TEXT,
  "is_ground_truth" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_human_verifications_pkey" PRIMARY KEY ("sequence")
);

CREATE UNIQUE INDEX "ai_datasets_name_key" ON "ai_datasets"("name");
CREATE UNIQUE INDEX "ai_dataset_items_source_key" ON "ai_dataset_items"("dataset_id", "source_type", "source_id");
CREATE INDEX "ai_dataset_items_user_partition_idx" ON "ai_dataset_items"("dataset_id", "user_id", "partition", "created_at");
CREATE INDEX "ai_analysis_runs_user_created_idx" ON "ai_analysis_runs"("user_id", "created_at" DESC);
CREATE INDEX "ai_analysis_runs_dataset_status_idx" ON "ai_analysis_runs"("dataset_id", "status", "created_at" DESC);
CREATE INDEX "ai_knowledge_observations_user_sequence_idx" ON "ai_knowledge_observations"("user_id", "sequence");
CREATE INDEX "ai_knowledge_observations_source_sequence_idx" ON "ai_knowledge_observations"("source_type", "source_id", "sequence");
CREATE INDEX "ai_human_verifications_user_target_idx" ON "ai_human_verifications"("user_id", "target_type", "target_id", "sequence" DESC);
CREATE INDEX "ai_human_verifications_target_idx" ON "ai_human_verifications"("target_type", "target_id", "sequence" DESC);

ALTER TABLE "ai_dataset_items" ADD CONSTRAINT "ai_dataset_items_dataset_id_fkey"
  FOREIGN KEY ("dataset_id") REFERENCES "ai_datasets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ai_dataset_items" ADD CONSTRAINT "ai_dataset_items_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_dataset_id_fkey"
  FOREIGN KEY ("dataset_id") REFERENCES "ai_datasets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ai_knowledge_observations" ADD CONSTRAINT "ai_knowledge_observations_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "ai_analysis_runs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "ai_knowledge_observations" ADD CONSTRAINT "ai_knowledge_observations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "ai_human_verifications" ADD CONSTRAINT "ai_human_verifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- These tables are accessed by the backend through Prisma only.
ALTER TABLE "ai_datasets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_dataset_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_analysis_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_knowledge_observations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_human_verifications" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ai_datasets", "ai_dataset_items", "ai_analysis_runs",
  "ai_knowledge_observations", "ai_human_verifications" FROM PUBLIC;
REVOKE ALL ON SEQUENCE "ai_knowledge_observations_sequence_seq",
  "ai_human_verifications_sequence_seq" FROM PUBLIC;

DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF to_regrole(api_role) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE ai_datasets, ai_dataset_items, ai_analysis_runs, ai_knowledge_observations, ai_human_verifications FROM %I',
        api_role
      );
      EXECUTE format(
        'REVOKE ALL ON SEQUENCE ai_knowledge_observations_sequence_seq, ai_human_verifications_sequence_seq FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END;
$$;
