-- CreateTable
CREATE TABLE "ai_email_classification_minutes" (
  "user_id" TEXT NOT NULL,
  "minute" TIMESTAMPTZ(6) NOT NULL,
  "calls" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_email_classification_minutes_pkey" PRIMARY KEY ("user_id", "minute")
);

-- AddForeignKey
ALTER TABLE "ai_email_classification_minutes"
  ADD CONSTRAINT "ai_email_classification_minutes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
