-- Add client_message_id column for idempotent chat turns
ALTER TABLE "ai_messages"
ADD COLUMN IF NOT EXISTS "client_message_id" TEXT;

-- Backfill from legacy metadata JSON
UPDATE "ai_messages"
SET
    "client_message_id" = metadata ->> 'clientMessageId'
WHERE
    "client_message_id" IS NULL
    AND metadata ->> 'clientMessageId' IS NOT NULL
    AND metadata ->> 'clientMessageId' <> '';

-- One user + one assistant per turn per session
CREATE UNIQUE INDEX IF NOT EXISTS "ai_messages_session_id_role_client_message_id_key" ON "ai_messages" (
    "session_id",
    "role",
    "client_message_id"
);

CREATE INDEX IF NOT EXISTS "ai_messages_session_id_client_message_id_idx" ON "ai_messages" (
    "session_id",
    "client_message_id"
);
