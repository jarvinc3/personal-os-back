-- Bank notification sender + one mailbox per institution per user.

ALTER TABLE "fin_email_sources" ADD COLUMN "bank_sender_email" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "fin_email_sources"
    GROUP BY "user_id", "institution_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add unique (user_id, institution_id): duplicate FinEmailSource rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "fin_email_sources_user_institution_key"
  ON "fin_email_sources" ("user_id", "institution_id");
