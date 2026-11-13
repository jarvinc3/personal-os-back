CREATE TYPE "ai_email_product_proposal_type" AS ENUM ('ACCOUNT', 'CARD');
CREATE TYPE "ai_email_product_proposal_status" AS ENUM (
  'PENDING',
  'APPROVING',
  'APPROVED',
  'DISCARDED'
);

CREATE TABLE "ai_email_product_proposals" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "product_type" "ai_email_product_proposal_type" NOT NULL,
  "status" "ai_email_product_proposal_status" NOT NULL DEFAULT 'PENDING',
  "deduplication_key" TEXT NOT NULL,
  "draft" JSONB NOT NULL,
  "approved_product_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_email_product_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_email_product_proposals_user_dedupe_key"
    UNIQUE ("user_id", "deduplication_key"),
  CONSTRAINT "ai_email_product_proposals_id_user_id_key"
    UNIQUE ("id", "user_id"),
  CONSTRAINT "ai_email_product_proposals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "ai_email_product_proposal_evidence" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "proposal_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_email_product_proposal_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_email_product_proposal_evidence_proposal_message_key"
    UNIQUE ("proposal_id", "message_id"),
  CONSTRAINT "ai_email_product_proposal_evidence_proposal_id_user_id_fkey"
    FOREIGN KEY ("proposal_id", "user_id")
    REFERENCES "ai_email_product_proposals"("id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ai_email_product_proposal_evidence_message_id_user_id_fkey"
    FOREIGN KEY ("message_id", "user_id")
    REFERENCES "ai_email_messages"("id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ai_email_product_proposal_evidence_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "ai_email_product_proposals_user_status_idx"
  ON "ai_email_product_proposals"("user_id", "status", "created_at" DESC);
CREATE INDEX "ai_email_product_proposal_evidence_user_proposal_idx"
  ON "ai_email_product_proposal_evidence"("user_id", "proposal_id");

ALTER TABLE "ai_email_product_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_email_product_proposal_evidence" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ai_email_product_proposals", "ai_email_product_proposal_evidence" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "ai_email_product_proposals", "ai_email_product_proposal_evidence" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "ai_email_product_proposals", "ai_email_product_proposal_evidence" FROM authenticated;
  END IF;
END $$;
