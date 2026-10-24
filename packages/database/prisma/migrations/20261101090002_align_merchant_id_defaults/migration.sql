-- Fecha real de creación: 2026-10-24. Corrección aditiva del drift #194:
-- el schema ya declara estos defaults; no se modifican filas existentes.
ALTER TABLE "fin_merchant_aliases"
  ALTER COLUMN "id" SET DEFAULT (uuid_generate_v4())::text;
ALTER TABLE "fin_merchant_duplicate_dismissals"
  ALTER COLUMN "id" SET DEFAULT (uuid_generate_v4())::text;
