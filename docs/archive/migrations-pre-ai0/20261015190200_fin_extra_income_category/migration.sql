-- System income category for receivable overpayments kept as extra income.

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
  'd5f9b3a2-8c4e-4f6b-0a7d-2b3c4d5e6f70',
  NULL,
  'Ingreso extra',
  NULL,
  '#16a34a',
  NULL,
  true,
  'EXTRA_INCOME',
  'INCOME'::"FinCategoryType",
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "fin_categories"
  WHERE "is_system" = true AND "system_kind" = 'EXTRA_INCOME'
);
