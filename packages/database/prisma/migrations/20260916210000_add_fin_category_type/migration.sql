-- Category type (EXPENSE vs INCOME) plus idempotent system catalog.

CREATE TYPE "FinCategoryType" AS ENUM ('EXPENSE', 'INCOME');

ALTER TABLE "fin_categories"
ADD COLUMN "type" "FinCategoryType" NOT NULL DEFAULT 'EXPENSE';

CREATE INDEX "fin_categories_user_id_type_idx"
ON "fin_categories"("user_id", "type");

-- Seed expense system categories only when the catalog has none.
INSERT INTO "fin_categories" (
  "id",
  "user_id",
  "name",
  "icon",
  "color",
  "parent_id",
  "is_system",
  "type",
  "created_at",
  "updated_at"
)
SELECT
  v."id",
  NULL,
  v."name",
  v."icon",
  v."color",
  NULL,
  true,
  'EXPENSE'::"FinCategoryType",
  NOW(),
  NOW()
FROM (
  VALUES
    ('e7c774ec-152a-43b8-8901-e40499e849a5', 'Alimentación', '🍽️', '#ef4444'),
    ('95ccac7b-8144-4efb-86a7-207608ffedb8', 'Transporte', '🚗', '#f97316'),
    ('28065f2d-9897-406b-b7fc-7cda629732ce', 'Vivienda', '🏠', '#a855f7'),
    ('bf3d88e7-d13b-4dd0-9572-83ab5e1ecbc6', 'Servicios', '💡', '#eab308'),
    ('2e8ce260-690c-4be8-9d27-fc1e51d2e578', 'Salud', '💊', '#22c55e'),
    ('3bc4665c-8ae8-41f5-a8f8-3349c10dbfd8', 'Educación', '📚', '#3b82f6'),
    ('80f86b18-c035-441f-911e-3d4d0592d99e', 'Entretenimiento', '🎬', '#ec4899'),
    ('7b4806f4-9d83-4f2b-86ff-429f4cfc2e03', 'Compras', '🛍️', '#14b8a6'),
    ('a5554aa6-38db-4282-a07a-b40b1b0b8c2c', 'Suscripciones', '📱', '#6366f1'),
    ('7c373c3e-aeff-4860-9a84-8f1748c4d48c', 'Cuidado personal', '💅', '#f43f5e'),
    ('e226000f-ec0d-44e4-9080-d20ff2d662d3', 'Viajes', '✈️', '#06b6d4'),
    ('74b5f764-af16-4ec6-a546-3337af4c9366', 'Impuestos y trámites', '🧾', '#78716c'),
    ('32124c13-046f-4ad0-92d7-76f690ae6e4f', 'Deudas', '💳', '#64748b'),
    ('8e895bab-4d56-4741-bf4c-06327fb79dc3', 'Otros', '📦', '#94a3b8')
) AS v("id", "name", "icon", "color")
WHERE NOT EXISTS (
  SELECT 1 FROM "fin_categories" WHERE "is_system" = true
);

-- Seed income system categories when that name+type is missing.
INSERT INTO "fin_categories" (
  "id",
  "user_id",
  "name",
  "icon",
  "color",
  "parent_id",
  "is_system",
  "type",
  "created_at",
  "updated_at"
)
SELECT
  v."id",
  NULL,
  v."name",
  v."icon",
  v."color",
  NULL,
  true,
  'INCOME'::"FinCategoryType",
  NOW(),
  NOW()
FROM (
  VALUES
    ('49041a3c-9f6d-4f91-a268-891c9e92a046', 'Salario', '💼', '#16a34a'),
    ('911c2a68-5ddc-4022-bb5f-179cc1644ac3', 'Freelance', '🧑‍💻', '#0ea5e9'),
    ('2640827c-1ae6-4336-a63e-03457f16f6e1', 'Negocio', '🏪', '#2563eb'),
    ('a174bf39-e40f-472b-9bec-a14f167f899d', 'Inversiones', '📈', '#7c3aed'),
    ('2dbedbbd-03b6-4cc1-9d0e-552e06b4edc9', 'Transferencias', '💸', '#059669'),
    ('9ff3f9ab-105e-4ffa-9651-45584dc5ad7c', 'Reembolsos', '↩️', '#ca8a04'),
    ('7f3dce7e-d4c1-47e5-a7d4-89c53675ba12', 'Regalos', '🎁', '#db2777'),
    ('1663861d-9bff-46a0-9266-a8b9f3a964cd', 'Otros ingresos', '📥', '#64748b')
) AS v("id", "name", "icon", "color")
WHERE NOT EXISTS (
  SELECT 1
  FROM "fin_categories" AS c
  WHERE c."is_system" = true
    AND c."name" = v."name"
    AND c."type" = 'INCOME'::"FinCategoryType"
);
