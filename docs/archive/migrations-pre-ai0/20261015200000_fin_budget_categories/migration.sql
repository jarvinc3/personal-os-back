-- Multi-category budgets: category set, rollover and recurrence.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fin_budget_rollover') THEN
    CREATE TYPE "fin_budget_rollover" AS ENUM ('NONE', 'SURPLUS', 'SURPLUS_AND_DEFICIT');
  END IF;
END $$;

ALTER TABLE "fin_budgets"
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "include_children" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "rollover" "fin_budget_rollover" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "carried_over" DECIMAL(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "recurring" BOOLEAN NOT NULL DEFAULT false,
  ALTER COLUMN "category_id" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "fin_budget_categories" (
  "budget_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  CONSTRAINT "fin_budget_categories_pkey" PRIMARY KEY ("budget_id", "category_id")
);

CREATE INDEX IF NOT EXISTS "fin_budget_categories_category_id_idx"
  ON "fin_budget_categories"("category_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_budget_categories_budget_id_fkey') THEN
    ALTER TABLE "fin_budget_categories"
      ADD CONSTRAINT "fin_budget_categories_budget_id_fkey"
      FOREIGN KEY ("budget_id") REFERENCES "fin_budgets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_budget_categories_category_id_fkey') THEN
    ALTER TABLE "fin_budget_categories"
      ADD CONSTRAINT "fin_budget_categories_category_id_fkey"
      FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

INSERT INTO "fin_budget_categories" ("budget_id", "category_id")
SELECT "id", "category_id" FROM "fin_budgets"
WHERE "category_id" IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE "fin_budgets" b
SET "name" = c."name"
FROM "fin_categories" c
WHERE b."category_id" = c."id" AND b."name" IS NULL;

ALTER TABLE "fin_budgets"
  DROP CONSTRAINT IF EXISTS "fin_budgets_user_category_period_key";
