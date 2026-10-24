/*
  Pendiente 16 · Modelo de efectivo.

  Every user gets exactly one system "Efectivo" institution (type = 'cash',
  is_system = true). Existing CASH accounts without an institution move into it
  and users without cash get the default "Efectivo" account in their base
  currency. Idempotent: running it twice changes nothing.

  Naming note: the folder must sort after the last applied migration
  (`20261021100000`). The real system date is earlier, so the timestamp is
  corrected as allowed by docs/infrastructure/database.md (registrar el ajuste).
*/

-- 1. System flag and the partial unique guard: one system cash institution per user.
ALTER TABLE "fin_institutions" ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "fin_institutions_system_cash_user_key"
  ON "fin_institutions"("user_id")
  WHERE ("type" = 'cash' AND "is_system" = true);

-- 2. Reuse the earliest cash institution each user already has as the system one.
UPDATE "fin_institutions" AS institution
SET "is_system" = true
WHERE institution."type" = 'cash'
  AND institution."id" = (
    SELECT candidate."id"
    FROM "fin_institutions" AS candidate
    WHERE candidate."user_id" = institution."user_id"
      AND candidate."type" = 'cash'
    ORDER BY candidate."created_at" ASC, candidate."id" ASC
    LIMIT 1
  );

-- 3. Create the system institution for users that do not have a cash one yet.
INSERT INTO "fin_institutions" ("user_id", "name", "type", "country", "is_system")
SELECT "user"."id", 'Efectivo', 'cash', 'DO', true
FROM "users" AS "user"
WHERE NOT EXISTS (
  SELECT 1
  FROM "fin_institutions" AS institution
  WHERE institution."user_id" = "user"."id"
    AND institution."type" = 'cash'
);

-- 4. Move every institution-less CASH account into its user's system institution.
UPDATE "fin_accounts" AS account
SET "institution_id" = institution."id"
FROM "fin_institutions" AS institution
WHERE institution."user_id" = account."user_id"
  AND institution."type" = 'cash'
  AND institution."is_system" = true
  AND account."type" = 'CASH'
  AND account."institution_id" IS NULL;

-- 5. Give every user one base-currency cash account when they have no cash at all.
INSERT INTO "fin_accounts" ("user_id", "institution_id", "name", "type", "currency")
SELECT
  "user"."id",
  institution."id",
  'Efectivo',
  'CASH',
  COALESCE(NULLIF(UPPER(module."config" ->> 'baseCurrency'), ''), 'DOP')
FROM "users" AS "user"
JOIN "fin_institutions" AS institution
  ON institution."user_id" = "user"."id"
  AND institution."type" = 'cash'
  AND institution."is_system" = true
LEFT JOIN "modules" AS module_definition ON module_definition."slug" = 'finance'
LEFT JOIN "user_modules" AS module
  ON module."user_id" = "user"."id" AND module."module_id" = module_definition."id"
WHERE NOT EXISTS (
  SELECT 1
  FROM "fin_accounts" AS account
  WHERE account."user_id" = "user"."id"
    AND account."type" = 'CASH'
);

-- 6. Every account belongs to an institution, CASH included.
ALTER TABLE "fin_accounts" DROP CONSTRAINT IF EXISTS "fin_accounts_institution_by_type_check";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_accounts_institution_required_check'
  ) THEN
    ALTER TABLE "fin_accounts"
      ADD CONSTRAINT "fin_accounts_institution_required_check"
      CHECK ("institution_id" IS NOT NULL);
  END IF;
END $$;
