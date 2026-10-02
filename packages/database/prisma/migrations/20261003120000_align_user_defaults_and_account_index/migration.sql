-- Index declared in schema.prisma but missing from migrations (created manually in prod).
CREATE INDEX IF NOT EXISTS "fin_accounts_user_institution_default_idx"
ON "fin_accounts"("user_id", "institution_id", "is_default_for_institution");

-- Align user column defaults with schema.prisma (drift in the shared database).
ALTER TABLE "users" ALTER COLUMN "avatar_url" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "preferences" SET DEFAULT '{}';
