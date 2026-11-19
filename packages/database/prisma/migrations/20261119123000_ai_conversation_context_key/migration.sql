ALTER TABLE "ai_conversations" ADD COLUMN "context_key" TEXT;
CREATE INDEX "ai_conversations_user_context_updated_idx"
  ON "ai_conversations" ("user_id", "context_key", "updated_at" DESC, "id");