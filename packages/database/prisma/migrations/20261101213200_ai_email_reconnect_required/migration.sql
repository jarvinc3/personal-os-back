-- A connection whose refresh token is no longer valid needs the user to
-- authorize Gmail again; automatic retries cannot fix it.
ALTER TABLE "ai_email_connections"
ADD COLUMN "reconnect_required_at" TIMESTAMPTZ(6);

UPDATE "ai_email_connections"
SET "reconnect_required_at" = COALESCE("last_failure_at", "updated_at")
WHERE "last_sync_error_code" IN ('invalid_grant', 'gmail_refresh_token_missing');
