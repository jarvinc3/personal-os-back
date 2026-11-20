-- CreateTable
CREATE TABLE "ai_proactive_suggestions" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "signal_id" TEXT NOT NULL,
  "signal_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "action_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_proactive_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_proactive_discards" (
  "user_id" TEXT NOT NULL,
  "window_started_at" TIMESTAMPTZ(6) NOT NULL,
  "discarded" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_proactive_discards_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_proactive_suggestions_user_signal_key" ON "ai_proactive_suggestions"("user_id", "signal_id");

-- CreateIndex
CREATE INDEX "ai_proactive_suggestions_user_created_idx" ON "ai_proactive_suggestions"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "ai_proactive_suggestions"
  ADD CONSTRAINT "ai_proactive_suggestions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_proactive_discards"
  ADD CONSTRAINT "ai_proactive_discards_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
