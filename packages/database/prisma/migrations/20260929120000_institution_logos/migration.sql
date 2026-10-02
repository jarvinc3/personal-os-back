-- Institution brand fields for Logo.dev, plus the public logos bucket.
-- logo_url stays as a legacy fallback until nothing reads it.

ALTER TABLE "fin_institutions"
ADD COLUMN "type" TEXT NOT NULL DEFAULT 'bank',
ADD COLUMN "short_name" TEXT,
ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "domain" TEXT,
ADD COLUMN "logo_path" TEXT,
ADD COLUMN "custom_logo_path" TEXT;

ALTER TABLE "fin_institutions"
ADD CONSTRAINT "fin_institutions_type_check"
CHECK ("type" IN ('bank', 'credit_union', 'digital_wallet', 'broker', 'cash', 'other'));

ALTER TABLE "fin_institutions"
ADD CONSTRAINT "fin_institutions_domain_check"
CHECK ("domain" IS NULL OR "domain" ~ '^[a-z0-9.-]+\.[a-z]{2,}$');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "fin_institutions"
    GROUP BY "user_id", lower("name")
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'fin_institutions has duplicate names per user; resolve them before the unique index';
  END IF;
END $$;

CREATE UNIQUE INDEX "fin_institutions_user_name_uq"
ON "fin_institutions" ("user_id", lower("name"));

-- Shadow databases used by Prisma do not include Supabase storage.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.schemata
    WHERE schema_name = 'storage'
  ) THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('logos', 'logos', true)
    ON CONFLICT (id) DO UPDATE SET public = true;
  END IF;
END $$;
