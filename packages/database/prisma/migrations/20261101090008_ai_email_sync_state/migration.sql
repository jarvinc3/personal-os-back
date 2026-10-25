-- Creada el 2026-10-25; el timestamp sigue la última migración existente.
ALTER TABLE "ai_email_connections"
ADD COLUMN "sync_state" JSONB;
