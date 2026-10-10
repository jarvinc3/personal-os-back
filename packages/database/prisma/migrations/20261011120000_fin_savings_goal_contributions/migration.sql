-- Amounts set aside for a savings goal. The goal balance is the sum of these
-- rows; the money itself is not moved between accounts.
CREATE TABLE IF NOT EXISTS "fin_savings_goal_contributions" (
  "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
  "goal_id" TEXT NOT NULL,
  "amount" DECIMAL(15, 2) NOT NULL,
  "contributed_at" DATE NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fin_savings_goal_contributions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fin_savings_goal_contributions_goal_id_date_idx"
  ON "fin_savings_goal_contributions"("goal_id", "contributed_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_savings_goal_contributions_goal_id_fkey'
  ) THEN
    ALTER TABLE "fin_savings_goal_contributions"
      ADD CONSTRAINT "fin_savings_goal_contributions_goal_id_fkey"
      FOREIGN KEY ("goal_id") REFERENCES "fin_savings_goals"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- Balances recorded before the history existed become one opening contribution,
-- so the sum of the rows still matches the balance users already saw.
INSERT INTO "fin_savings_goal_contributions" ("goal_id", "amount", "contributed_at", "notes")
SELECT "id", "current_amount", "created_at"::date, 'Saldo inicial'
FROM "fin_savings_goals"
WHERE "current_amount" > 0;
