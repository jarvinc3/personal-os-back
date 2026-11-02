CREATE TYPE "ai_conversation_message_role" AS ENUM ('USER', 'ASSISTANT', 'TOOL');

CREATE TABLE "ai_conversations" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'Nueva conversación',
  "summary" TEXT,
  "summary_updated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_conversations_id_user_id_key" UNIQUE ("id", "user_id"),
  CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "ai_conversation_messages" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "conversation_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "sequence" SERIAL NOT NULL,
  "role" "ai_conversation_message_role" NOT NULL,
  "content" TEXT NOT NULL,
  "name" TEXT,
  "tool_call_id" TEXT,
  "tool_calls" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_conversation_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_conversation_messages_conversation_sequence_key" UNIQUE ("conversation_id", "sequence"),
  CONSTRAINT "ai_conversation_messages_conversation_id_user_id_fkey"
    FOREIGN KEY ("conversation_id", "user_id")
    REFERENCES "ai_conversations"("id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "ai_conversations_user_updated_idx"
  ON "ai_conversations"("user_id", "updated_at" DESC, "id");
CREATE INDEX "ai_conversation_messages_user_order_idx"
  ON "ai_conversation_messages"("user_id", "conversation_id", "sequence");

ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_conversation_messages" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ai_conversations", "ai_conversation_messages" FROM PUBLIC;
REVOKE ALL ON SEQUENCE "ai_conversation_messages_sequence_seq" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "ai_conversations", "ai_conversation_messages" FROM anon;
    REVOKE ALL ON SEQUENCE "ai_conversation_messages_sequence_seq" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "ai_conversations", "ai_conversation_messages" FROM authenticated;
    REVOKE ALL ON SEQUENCE "ai_conversation_messages_sequence_seq" FROM authenticated;
  END IF;
END $$;
