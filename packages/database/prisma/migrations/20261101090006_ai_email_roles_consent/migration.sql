-- Creada el 2026-10-24. Timestamp posterior a la última migración del repo.
CREATE TYPE "ai_user_role" AS ENUM ('USER', 'CONTRIBUTOR', 'ADMIN');
CREATE TYPE "ai_email_processing_status" AS ENUM (
  'INGESTED',
  'QUEUED',
  'PROCESSED',
  'REVIEW_REQUIRED',
  'FAILED'
);

CREATE TABLE "user_roles" (
  "user_id" TEXT NOT NULL,
  "role" "ai_user_role" NOT NULL DEFAULT 'USER',
  "granted_by" TEXT,
  "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "user_ai_settings" (
  "user_id" TEXT NOT NULL,
  "contribute_to_global_knowledge" BOOLEAN NOT NULL DEFAULT true,
  "contribution_consent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_ai_settings_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "ai_email_connections" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'GMAIL',
  "email_address" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "access_token_encrypted" TEXT NOT NULL,
  "refresh_token_encrypted" TEXT,
  "token_expires_at" TIMESTAMPTZ(6),
  "provider_cursor" TEXT,
  "bootstrap_page_token" TEXT,
  "bootstrap_started_at" TIMESTAMPTZ(6),
  "initial_sync_completed_at" TIMESTAMPTZ(6),
  "last_synced_at" TIMESTAMPTZ(6),
  "last_recovery_sync_at" TIMESTAMPTZ(6),
  "imported_message_count" INTEGER NOT NULL DEFAULT 0,
  "last_sync_error_code" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_email_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_email_messages" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "provider_message_id" TEXT NOT NULL,
  "provider_thread_id" TEXT,
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "from_address" TEXT NOT NULL,
  "from_domain" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "content_fingerprint" TEXT NOT NULL,
  "template_fingerprint" TEXT,
  "processing_status" "ai_email_processing_status" NOT NULL DEFAULT 'INGESTED',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_email_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_email_message_content" (
  "message_id" TEXT NOT NULL,
  "raw_body" TEXT,
  "sanitized_body" TEXT,
  "canonical_body" TEXT,
  "snippet" TEXT,
  "retention_expires_at" TIMESTAMPTZ(6),
  CONSTRAINT "ai_email_message_content_pkey" PRIMARY KEY ("message_id")
);

CREATE UNIQUE INDEX "ai_email_connections_user_id_key" ON "ai_email_connections"("user_id");
CREATE UNIQUE INDEX "ai_email_connections_id_user_id_key" ON "ai_email_connections"("id", "user_id");
CREATE UNIQUE INDEX "ai_email_messages_connection_provider_id_key" ON "ai_email_messages"("connection_id", "provider_message_id");
CREATE INDEX "ai_email_messages_user_received_at_idx" ON "ai_email_messages"("user_id", "received_at" DESC);
CREATE INDEX "ai_email_messages_user_status_received_at_idx" ON "ai_email_messages"("user_id", "processing_status", "received_at" DESC);
CREATE INDEX "ai_email_message_content_retention_idx" ON "ai_email_message_content"("retention_expires_at");
CREATE INDEX "user_roles_role_updated_at_idx" ON "user_roles"("role", "updated_at");

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_fkey"
  FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "user_ai_settings" ADD CONSTRAINT "user_ai_settings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ai_email_connections" ADD CONSTRAINT "ai_email_connections_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ai_email_messages" ADD CONSTRAINT "ai_email_messages_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ai_email_messages" ADD CONSTRAINT "ai_email_messages_connection_id_user_id_fkey"
  FOREIGN KEY ("connection_id", "user_id") REFERENCES "ai_email_connections"("id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "ai_email_message_content" ADD CONSTRAINT "ai_email_message_content_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "ai_email_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

INSERT INTO "user_roles" ("user_id", "role")
SELECT "id", 'USER'::"ai_user_role" FROM "users";
INSERT INTO "user_ai_settings" ("user_id")
SELECT "id" FROM "users";

-- OAuth credentials and message bodies stay server-only. Supabase REST roles
-- receive no table privileges; the backend accesses these through Prisma.
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_ai_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_email_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_email_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_email_message_content" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "user_roles", "user_ai_settings", "ai_email_connections",
  "ai_email_messages", "ai_email_message_content" FROM PUBLIC;

DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF to_regrole(api_role) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE user_roles, user_ai_settings, ai_email_connections, ai_email_messages, ai_email_message_content FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END;
$$;
