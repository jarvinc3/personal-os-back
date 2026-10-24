-- Brand logo for merchants, same semantics as institutions: the chosen domain
-- keeps brands/{domain}.png in the bucket, the own upload goes to custom. The
-- legacy logo_url column stays so logos uploaded before still resolve.
ALTER TABLE "fin_merchants" ADD COLUMN     "domain" TEXT,
ADD COLUMN     "logo_path" TEXT,
ADD COLUMN     "custom_logo_path" TEXT;
