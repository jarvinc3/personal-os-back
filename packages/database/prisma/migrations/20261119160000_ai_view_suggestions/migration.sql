-- CreateEnum
CREATE TYPE "AiViewSuggestionStatus" AS ENUM ('ACTIVE', 'DISMISSED');

-- CreateTable
CREATE TABLE "ai_view_suggestions" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "view_key" TEXT NOT NULL,
  "suggestion_key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "action_id" TEXT,
  "status" "AiViewSuggestionStatus" NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "dismissed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_view_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_view_suggestion_budgets" (
  "user_id" TEXT NOT NULL,
  "budget_date" DATE NOT NULL,
  "calls" INTEGER NOT NULL DEFAULT 0,
  "daily_limit" INTEGER NOT NULL DEFAULT 100,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_view_suggestion_budgets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "ai_view_suggestion_minutes" (
  "user_id" TEXT NOT NULL,
  "minute" TIMESTAMPTZ(6) NOT NULL,
  "calls" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_view_suggestion_minutes_pkey" PRIMARY KEY ("user_id", "minute")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_view_suggestions_owner_view_key" ON "ai_view_suggestions"("user_id", "route", "view_key", "suggestion_key");

-- CreateIndex
CREATE INDEX "ai_view_suggestions_active_idx" ON "ai_view_suggestions"("user_id", "route", "view_key", "status", "expires_at");

-- AddForeignKey
ALTER TABLE "ai_view_suggestions"
  ADD CONSTRAINT "ai_view_suggestions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_view_suggestion_budgets"
  ADD CONSTRAINT "ai_view_suggestion_budgets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_view_suggestion_minutes"
  ADD CONSTRAINT "ai_view_suggestion_minutes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- Protect the new tables like the rest of the schema.
ALTER TABLE "ai_view_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_view_suggestion_budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_view_suggestion_minutes" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ai_view_suggestions" FROM PUBLIC;
REVOKE ALL ON TABLE "ai_view_suggestion_budgets" FROM PUBLIC;
REVOKE ALL ON TABLE "ai_view_suggestion_minutes" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "ai_view_suggestions" FROM anon;
    REVOKE ALL ON TABLE "ai_view_suggestion_budgets" FROM anon;
    REVOKE ALL ON TABLE "ai_view_suggestion_minutes" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "ai_view_suggestions" FROM authenticated;
    REVOKE ALL ON TABLE "ai_view_suggestion_budgets" FROM authenticated;
    REVOKE ALL ON TABLE "ai_view_suggestion_minutes" FROM authenticated;
  END IF;
END $$;
