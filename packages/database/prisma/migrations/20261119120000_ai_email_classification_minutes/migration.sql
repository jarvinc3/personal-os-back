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

-- Protect the new table like the rest of the schema.
ALTER TABLE "ai_email_classification_minutes" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ai_email_classification_minutes" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "ai_email_classification_minutes" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "ai_email_classification_minutes" FROM authenticated;
  END IF;
END $$;
