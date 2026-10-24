-- System categories for card charges, plus the bank-fee kind on the category the
-- transfer-fee migration seeded. Idempotent.

INSERT INTO "fin_categories" (
  "id",
  "user_id",
  "name",
  "icon",
  "color",
  "parent_id",
  "is_system",
  "system_kind",
  "type",
  "created_at",
  "updated_at"
)
SELECT
  'e6a0c4b3-9d5f-4a7c-1b8e-3c4d5e6f7081',
  NULL,
  'Intereses',
  NULL,
  '#dc2626',
  NULL,
  true,
  'INTEREST',
  'EXPENSE'::"FinCategoryType",
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "fin_categories"
  WHERE "is_system" = true AND "system_kind" = 'INTEREST'
);

INSERT INTO "fin_categories" (
  "id",
  "user_id",
  "name",
  "icon",
  "color",
  "parent_id",
  "is_system",
  "system_kind",
  "type",
  "created_at",
  "updated_at"
)
SELECT
  'f7b1d5c4-ae60-4b8d-2c9f-4d5e6f708192',
  NULL,
  'Comisiones',
  NULL,
  '#64748b',
  NULL,
  true,
  'FEE',
  'EXPENSE'::"FinCategoryType",
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "fin_categories"
  WHERE "is_system" = true AND "system_kind" = 'FEE'
);

INSERT INTO "fin_categories" (
  "id",
  "user_id",
  "name",
  "icon",
  "color",
  "parent_id",
  "is_system",
  "system_kind",
  "type",
  "created_at",
  "updated_at"
)
SELECT
  '08c2e6d5-bf71-4c9e-3da0-5e6f70819203',
  NULL,
  'Avance de efectivo',
  NULL,
  '#b45309',
  NULL,
  true,
  'CASH_ADVANCE',
  'EXPENSE'::"FinCategoryType",
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "fin_categories"
  WHERE "is_system" = true AND "system_kind" = 'CASH_ADVANCE'
);

UPDATE "fin_categories"
SET "system_kind" = 'BANK_FEE'
WHERE "is_system" = true
  AND "name" = 'Comisiones bancarias'
  AND "system_kind" IS NULL;
