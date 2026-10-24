-- AlterTable
ALTER TABLE "ai_agent_sessions" ADD COLUMN "chat_context" JSONB NOT NULL DEFAULT '{}';
