-- Creada el 2026-10-26; timestamp posterior a la última migración del repo.
CREATE TYPE "ai_knowledge_scope" AS ENUM ('GLOBAL', 'USER');
CREATE TYPE "ai_knowledge_type" AS ENUM ('EMAIL_SENDER', 'EMAIL_DOMAIN', 'EMAIL_TEMPLATE', 'ENTITY', 'RELATION', 'USER_MAPPING');
CREATE TYPE "ai_knowledge_state" AS ENUM ('OBSERVED', 'STABLE', 'REVIEW_REQUIRED', 'BLOCKED');
CREATE TYPE "ai_knowledge_promotion" AS ENUM ('AUTO', 'CONTRIBUTOR', 'ADMIN');
CREATE TYPE "ai_run_reproduction_status" AS ENUM ('COMPLETE', 'INCOMPLETE');

ALTER TABLE "ai_analysis_runs"
  ADD COLUMN "consent_revision" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "reproduction_status" "ai_run_reproduction_status" NOT NULL DEFAULT 'COMPLETE',
  ADD COLUMN "missing_evidence" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "ai_knowledge_observations"
  DROP CONSTRAINT "ai_knowledge_observations_user_id_fkey",
  ALTER COLUMN "source_id" DROP NOT NULL,
  ALTER COLUMN "payload" DROP NOT NULL,
  ADD COLUMN "contributor_tombstone" TEXT,
  ADD COLUMN "tombstone_eligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "normalizer_version" TEXT,
  ADD COLUMN "derived_from_knowledge_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ai_knowledge_observations"
  ADD CONSTRAINT "ai_knowledge_observations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "ai_human_verifications"
  DROP CONSTRAINT "ai_human_verifications_user_id_fkey",
  ALTER COLUMN "user_id" DROP NOT NULL,
  ALTER COLUMN "target_id" DROP NOT NULL,
  ADD COLUMN "structural_keys" JSONB,
  ADD COLUMN "structural_payload" JSONB,
  ADD COLUMN "contributor_tombstone" TEXT,
  ADD COLUMN "tombstone_eligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "normalizer_version" TEXT;
ALTER TABLE "ai_human_verifications"
  ADD CONSTRAINT "ai_human_verifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "ai_knowledge" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "scope" "ai_knowledge_scope" NOT NULL,
  "user_id" TEXT,
  "knowledge_type" "ai_knowledge_type" NOT NULL,
  "knowledge_key" TEXT NOT NULL,
  "state" "ai_knowledge_state" NOT NULL,
  "payload" JSONB NOT NULL,
  "messages_seen" INTEGER NOT NULL DEFAULT 0,
  "rejected_messages" INTEGER NOT NULL DEFAULT 0,
  "distinct_users" INTEGER NOT NULL DEFAULT 0,
  "human_verified_count" INTEGER NOT NULL DEFAULT 0,
  "promoted_by" "ai_knowledge_promotion",
  "projector_version" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "normalizer_version" TEXT NOT NULL,
  "sanitizer_version" TEXT NOT NULL,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_knowledge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_knowledge_scope_user_check" CHECK (
    ("scope" = 'GLOBAL' AND "user_id" IS NULL) OR
    ("scope" = 'USER' AND "user_id" IS NOT NULL)
  ),
  CONSTRAINT "ai_knowledge_global_type_check" CHECK (
    "scope" = 'USER' OR "knowledge_type" IN ('EMAIL_DOMAIN', 'EMAIL_TEMPLATE')
  )
);
CREATE UNIQUE INDEX "ai_knowledge_global_key" ON "ai_knowledge"("knowledge_type", "knowledge_key") WHERE "scope" = 'GLOBAL';
CREATE UNIQUE INDEX "ai_knowledge_user_key" ON "ai_knowledge"("user_id", "knowledge_type", "knowledge_key") WHERE "scope" = 'USER';
CREATE INDEX "ai_knowledge_scope_state_idx" ON "ai_knowledge"("scope", "state", "updated_at");
CREATE INDEX "ai_knowledge_user_lookup_idx" ON "ai_knowledge"("user_id", "knowledge_type", "knowledge_key");
ALTER TABLE "ai_knowledge" ADD CONSTRAINT "ai_knowledge_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "ai_consent_events" (
  "sequence" BIGSERIAL NOT NULL,
  "user_id" TEXT,
  "contributor_tombstone" TEXT,
  "contribute_to_global_knowledge" BOOLEAN NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_consent_events_pkey" PRIMARY KEY ("sequence"),
  CONSTRAINT "ai_consent_events_owner_check" CHECK (
    ("user_id" IS NOT NULL AND "contributor_tombstone" IS NULL) OR
    ("user_id" IS NULL AND "contributor_tombstone" IS NOT NULL)
  )
);
CREATE INDEX "ai_consent_events_user_sequence_idx" ON "ai_consent_events"("user_id", "sequence" DESC);
ALTER TABLE "ai_consent_events" ADD CONSTRAINT "ai_consent_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Seed the current consent view so pre-AI-4 users have an explicit revision.
INSERT INTO "ai_consent_events" ("user_id", "contribute_to_global_knowledge", "reason", "created_at")
SELECT "user_id", "contribute_to_global_knowledge", 'AI4_BASELINE', "contribution_consent_at"
FROM "user_ai_settings";

ALTER TABLE "ai_knowledge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_consent_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ai_knowledge", "ai_consent_events" FROM PUBLIC;
REVOKE ALL ON SEQUENCE "ai_consent_events_sequence_seq" FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF to_regrole(api_role) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE ai_knowledge, ai_consent_events FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE ai_consent_events_sequence_seq FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;
