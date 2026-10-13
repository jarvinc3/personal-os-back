-- Goal mode and allocations: a goal lives in an account, and an allocation is
-- an earmark, not a movement.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fin_goal_mode') THEN
    CREATE TYPE "fin_goal_mode" AS ENUM ('EARMARK', 'DEDICATED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fin_allocation_kind') THEN
    CREATE TYPE "fin_allocation_kind" AS ENUM ('CONTRIBUTION', 'WITHDRAWAL');
  END IF;
END $$;

ALTER TABLE "fin_savings_goals"
  ADD COLUMN IF NOT EXISTS "account_id" TEXT,
  ADD COLUMN IF NOT EXISTS "mode" "fin_goal_mode" NOT NULL DEFAULT 'EARMARK',
  ADD COLUMN IF NOT EXISTS "spend_reduces_progress" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "fin_savings_goal_contributions"
  ADD COLUMN IF NOT EXISTS "kind" "fin_allocation_kind" NOT NULL DEFAULT 'CONTRIBUTION',
  ADD COLUMN IF NOT EXISTS "transfer_group_id" TEXT;

CREATE INDEX IF NOT EXISTS "fin_savings_goals_account_id_idx"
  ON "fin_savings_goals"("account_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_savings_goals_account_id_fkey') THEN
    ALTER TABLE "fin_savings_goals"
      ADD CONSTRAINT "fin_savings_goals_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- Point each goal at the account its contributions left most often.
UPDATE "fin_savings_goals" g
SET "account_id" = most_used."account_id"
FROM (
  SELECT DISTINCT ON ("goal_id") "goal_id", "account_id"
  FROM "fin_savings_goal_contributions"
  WHERE "account_id" IS NOT NULL
  GROUP BY "goal_id", "account_id"
  ORDER BY "goal_id", COUNT(*) DESC
) AS most_used
WHERE g."id" = most_used."goal_id" AND g."account_id" IS NULL;
