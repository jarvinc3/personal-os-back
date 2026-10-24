-- Timeline of an instrument (account or card): credit-limit changes today, and
-- adjustments fit here once the history query unions them with fin_transactions.

CREATE TABLE IF NOT EXISTS "fin_instrument_events" (
  "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "account_id" TEXT,
  "card_id" TEXT,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fin_instrument_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fin_instrument_events_account_created_idx"
  ON "fin_instrument_events"("account_id", "created_at");

CREATE INDEX IF NOT EXISTS "fin_instrument_events_card_created_idx"
  ON "fin_instrument_events"("card_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_instrument_events_user_id_fkey'
  ) THEN
    ALTER TABLE "fin_instrument_events"
      ADD CONSTRAINT "fin_instrument_events_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_instrument_events_account_id_fkey'
  ) THEN
    ALTER TABLE "fin_instrument_events"
      ADD CONSTRAINT "fin_instrument_events_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_instrument_events_card_id_fkey'
  ) THEN
    ALTER TABLE "fin_instrument_events"
      ADD CONSTRAINT "fin_instrument_events_card_id_fkey"
      FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
