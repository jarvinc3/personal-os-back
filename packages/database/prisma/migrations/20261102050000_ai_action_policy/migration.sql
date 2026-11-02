-- CreateEnum
CREATE TYPE "AiActionPolicy" AS ENUM ('AUTO_ALLOWED', 'CONFIRM_REQUIRED', 'FORBIDDEN');

-- AlterTable
ALTER TABLE "ai_actions"
  ADD COLUMN "policy" "AiActionPolicy" NOT NULL DEFAULT 'FORBIDDEN',
  ADD COLUMN "policy_version" TEXT NOT NULL DEFAULT 'ai-10-v1',
  ADD COLUMN "argument_digest" TEXT;

-- Fail closed for proposals persisted before every write had an explicit policy.
UPDATE "ai_actions"
SET "status" = 'CANCELLED',
    "result" = '{"ok":false,"error":"LEGACY_ACTION_REQUIRES_REVIEW"}'::jsonb,
    "executed_at" = COALESCE("executed_at", CURRENT_TIMESTAMP)
WHERE "status" = 'PENDING';

-- CreateIndex
CREATE INDEX "ai_actions_user_status_created_idx"
  ON "ai_actions"("user_id", "status", "created_at");
