-- Finance ownership: email connections, institutional sources, CASH institution,
-- loan institution, transaction ↔ email message FK.

-- ── Enum ────────────────────────────────────────────────────────────────────
ALTER TYPE "FinEmailMessageOutcome" ADD VALUE IF NOT EXISTS 'PENDING_ASSIGNMENT';

-- ── Accounts: optional institution for CASH + last_four ─────────────────────
ALTER TABLE "fin_accounts" ALTER COLUMN "institution_id" DROP NOT NULL;
ALTER TABLE "fin_accounts" ADD COLUMN IF NOT EXISTS "last_four" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_accounts_last_four_digits_check'
  ) THEN
    ALTER TABLE "fin_accounts"
      ADD CONSTRAINT "fin_accounts_last_four_digits_check"
      CHECK ("last_four" IS NULL OR "last_four" ~ '^[0-9]{4}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_accounts_institution_by_type_check'
  ) THEN
    ALTER TABLE "fin_accounts"
      ADD CONSTRAINT "fin_accounts_institution_by_type_check"
      CHECK ("type" = 'CASH' OR "institution_id" IS NOT NULL);
  END IF;
END $$;

-- ── Loans: optional catalog institution ─────────────────────────────────────
ALTER TABLE "fin_loans" ADD COLUMN IF NOT EXISTS "institution_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_loans_institution_id_fkey'
  ) THEN
    ALTER TABLE "fin_loans"
      ADD CONSTRAINT "fin_loans_institution_id_fkey"
      FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "fin_loans_institution_id_idx"
  ON "fin_loans"("institution_id");

UPDATE "fin_loans" l
SET "institution_id" = matched.id
FROM (
  SELECT DISTINCT ON (l2.id) l2.id AS loan_id, i.id
  FROM "fin_loans" l2
  INNER JOIN "fin_institutions" i
    ON i.user_id = l2.user_id
    AND i.is_active = true
    AND lower(btrim(i.name)) = lower(btrim(l2.lender_name))
  ORDER BY l2.id, i.created_at ASC
) AS matched
WHERE l.id = matched.loan_id
  AND (
    SELECT count(*) FROM "fin_institutions" i2
    WHERE i2.user_id = l.user_id
      AND i2.is_active = true
      AND lower(btrim(i2.name)) = lower(btrim(l.lender_name))
  ) = 1;

-- ── Email connections ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "fin_email_connections" (
  "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "email_address" TEXT NOT NULL,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "imap_host" TEXT,
  "token_expires_at" TIMESTAMPTZ(6),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fin_email_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fin_email_connections_user_provider_email_key"
  ON "fin_email_connections"("user_id", "provider", "email_address");
CREATE INDEX IF NOT EXISTS "fin_email_connections_user_id_active_idx"
  ON "fin_email_connections"("user_id", "is_active");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_email_connections_user_id_fkey'
  ) THEN
    ALTER TABLE "fin_email_connections"
      ADD CONSTRAINT "fin_email_connections_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

ALTER TABLE "fin_email_connections" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fin_email_connections_all_own" ON "fin_email_connections";
CREATE POLICY "fin_email_connections_all_own" ON "fin_email_connections"
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

INSERT INTO "fin_email_connections" (
  "user_id", "provider", "email_address",
  "access_token", "refresh_token", "imap_host", "token_expires_at",
  "is_active", "created_at", "updated_at"
)
SELECT DISTINCT ON (s.user_id, s.provider, s.email_address)
  s.user_id,
  s.provider,
  s.email_address,
  s.access_token,
  s.refresh_token,
  s.imap_host,
  s.token_expires_at,
  true,
  s.created_at,
  CURRENT_TIMESTAMP
FROM "fin_email_sources" s
ORDER BY s.user_id, s.provider, s.email_address, s.last_synced_at DESC NULLS LAST, s.created_at DESC;

-- ── Sources: add new FKs before dropping account/card ───────────────────────
ALTER TABLE "fin_email_sources" ADD COLUMN IF NOT EXISTS "connection_id" TEXT;
ALTER TABLE "fin_email_sources" ADD COLUMN IF NOT EXISTS "institution_id" TEXT;

UPDATE "fin_email_sources" s
SET "connection_id" = c.id
FROM "fin_email_connections" c
WHERE c.user_id = s.user_id
  AND c.provider = s.provider
  AND c.email_address = s.email_address;

UPDATE "fin_email_sources" s
SET "institution_id" = a.institution_id
FROM "fin_accounts" a
WHERE s.account_id = a.id
  AND s.institution_id IS NULL
  AND a.institution_id IS NOT NULL;

UPDATE "fin_email_sources" s
SET "institution_id" = c.institution_id
FROM "fin_cards" c
WHERE s.card_id = c.id
  AND s.institution_id IS NULL;

DO $$
DECLARE
  bad_ids TEXT;
BEGIN
  SELECT string_agg(id, ', ') INTO bad_ids
  FROM "fin_email_sources"
  WHERE "connection_id" IS NULL OR "institution_id" IS NULL;

  IF bad_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot migrate fin_email_sources without connection_id+institution_id: %',
      bad_ids;
  END IF;
END $$;

-- Merge duplicate (connection, institution) sources onto the keeper.
UPDATE "fin_email_messages" m
SET "source_id" = keeper.keep_id
FROM (
  SELECT DISTINCT ON (s.connection_id, s.institution_id)
    s.connection_id,
    s.institution_id,
    s.id AS keep_id
  FROM "fin_email_sources" s
  ORDER BY s.connection_id, s.institution_id, s.last_synced_at DESC NULLS LAST, s.created_at DESC
) keeper
WHERE m.source_id IN (
  SELECT s2.id FROM "fin_email_sources" s2
  WHERE s2.connection_id = keeper.connection_id
    AND s2.institution_id = keeper.institution_id
    AND s2.id <> keeper.keep_id
)
AND NOT EXISTS (
  SELECT 1 FROM "fin_email_messages" existing
  WHERE existing.source_id = keeper.keep_id
    AND existing.gmail_message_id = m.gmail_message_id
);

UPDATE "fin_email_sync_logs" l
SET "source_id" = keeper.keep_id
FROM (
  SELECT DISTINCT ON (s.connection_id, s.institution_id)
    s.connection_id,
    s.institution_id,
    s.id AS keep_id
  FROM "fin_email_sources" s
  ORDER BY s.connection_id, s.institution_id, s.last_synced_at DESC NULLS LAST, s.created_at DESC
) keeper
WHERE l.source_id IN (
  SELECT s2.id FROM "fin_email_sources" s2
  WHERE s2.connection_id = keeper.connection_id
    AND s2.institution_id = keeper.institution_id
    AND s2.id <> keeper.keep_id
);

DELETE FROM "fin_email_sources" s
WHERE EXISTS (
  SELECT 1 FROM "fin_email_sources" keep
  WHERE keep.connection_id = s.connection_id
    AND keep.institution_id = s.institution_id
    AND keep.id <> s.id
    AND (
      keep.last_synced_at IS NOT DISTINCT FROM s.last_synced_at
        AND keep.created_at > s.created_at
      OR keep.last_synced_at > s.last_synced_at
      OR (keep.last_synced_at IS NOT NULL AND s.last_synced_at IS NULL)
    )
);

DELETE FROM "fin_email_sources" s
USING "fin_email_sources" keep
WHERE s.connection_id = keep.connection_id
  AND s.institution_id = keep.institution_id
  AND s.id > keep.id;

ALTER TABLE "fin_email_sources" ALTER COLUMN "connection_id" SET NOT NULL;
ALTER TABLE "fin_email_sources" ALTER COLUMN "institution_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_email_sources_connection_id_fkey'
  ) THEN
    ALTER TABLE "fin_email_sources"
      ADD CONSTRAINT "fin_email_sources_connection_id_fkey"
      FOREIGN KEY ("connection_id") REFERENCES "fin_email_connections"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_email_sources_institution_id_fkey'
  ) THEN
    ALTER TABLE "fin_email_sources"
      ADD CONSTRAINT "fin_email_sources_institution_id_fkey"
      FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "fin_email_sources_connection_institution_key"
  ON "fin_email_sources"("connection_id", "institution_id");
CREATE INDEX IF NOT EXISTS "fin_email_sources_institution_id_idx"
  ON "fin_email_sources"("institution_id");
CREATE INDEX IF NOT EXISTS "fin_email_sources_connection_id_idx"
  ON "fin_email_sources"("connection_id");

ALTER TABLE "fin_email_sources" DROP CONSTRAINT IF EXISTS "fin_email_sources_account_xor_card_check";
ALTER TABLE "fin_email_sources" DROP CONSTRAINT IF EXISTS "fin_email_sources_account_id_fkey";
ALTER TABLE "fin_email_sources" DROP CONSTRAINT IF EXISTS "fin_email_sources_card_id_fkey";
DROP INDEX IF EXISTS "fin_email_sources_account_id_idx";
DROP INDEX IF EXISTS "fin_email_sources_card_id_idx";

ALTER TABLE "fin_email_sources" DROP COLUMN IF EXISTS "account_id";
ALTER TABLE "fin_email_sources" DROP COLUMN IF EXISTS "card_id";
ALTER TABLE "fin_email_sources" DROP COLUMN IF EXISTS "provider";
ALTER TABLE "fin_email_sources" DROP COLUMN IF EXISTS "email_address";
ALTER TABLE "fin_email_sources" DROP COLUMN IF EXISTS "access_token";
ALTER TABLE "fin_email_sources" DROP COLUMN IF EXISTS "refresh_token";
ALTER TABLE "fin_email_sources" DROP COLUMN IF EXISTS "imap_host";
ALTER TABLE "fin_email_sources" DROP COLUMN IF EXISTS "token_expires_at";

-- ── Email messages: routing hints ───────────────────────────────────────────
ALTER TABLE "fin_email_messages" ADD COLUMN IF NOT EXISTS "instrument_hint" TEXT;
ALTER TABLE "fin_email_messages" ADD COLUMN IF NOT EXISTS "last_four_hint" TEXT;
ALTER TABLE "fin_email_messages" ADD COLUMN IF NOT EXISTS "extracted_payload" JSONB;
CREATE INDEX IF NOT EXISTS "fin_email_messages_outcome_idx"
  ON "fin_email_messages"("outcome");

-- ── Transactions: FK to email message row; drop global Gmail unique ─────────
ALTER TABLE "fin_transactions" ADD COLUMN IF NOT EXISTS "email_message_row_id" TEXT;

UPDATE "fin_transactions" t
SET "email_message_row_id" = m.id
FROM "fin_email_messages" m
INNER JOIN "fin_email_sources" s ON s.id = m.source_id
WHERE t.email_message_id = m.gmail_message_id
  AND t.user_id = s.user_id
  AND t.email_message_row_id IS NULL
  AND (
    SELECT count(*) FROM "fin_email_messages" m2
    INNER JOIN "fin_email_sources" s2 ON s2.id = m2.source_id
    WHERE m2.gmail_message_id = t.email_message_id
      AND s2.user_id = t.user_id
  ) = 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fin_transactions_email_message_row_id_fkey'
  ) THEN
    ALTER TABLE "fin_transactions"
      ADD CONSTRAINT "fin_transactions_email_message_row_id_fkey"
      FOREIGN KEY ("email_message_row_id") REFERENCES "fin_email_messages"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "fin_transactions_email_message_row_id_key"
  ON "fin_transactions"("email_message_row_id");

ALTER TABLE "fin_transactions" DROP CONSTRAINT IF EXISTS "fin_transactions_email_message_id_key";
DROP INDEX IF EXISTS "fin_transactions_email_message_id_key";
CREATE INDEX IF NOT EXISTS "fin_transactions_email_message_id_idx"
  ON "fin_transactions"("email_message_id");
