-- System expense category for loan payments and prepayments.

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
  'c4e8a2f1-7b3d-4e5a-9f6c-1a2b3c4d5e6f',
  NULL,
  'Pago de préstamo',
  NULL,
  '#0f766e',
  NULL,
  true,
  'LOAN_PAYMENT',
  'EXPENSE'::"FinCategoryType",
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "fin_categories"
  WHERE "is_system" = true AND "system_kind" = 'LOAN_PAYMENT'
);
