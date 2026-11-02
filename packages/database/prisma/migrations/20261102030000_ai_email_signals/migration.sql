CREATE TYPE "ai_signal_status" AS ENUM ('DETECTED', 'VALIDATED', 'ROUTED', 'CONSUMED', 'DISMISSED', 'SUPERSEDED', 'FAILED');

CREATE TABLE "ai_signals" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "ai_signal_status" NOT NULL DEFAULT 'DETECTED',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "confidence" DOUBLE PRECISION,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deduplication_key" TEXT NOT NULL,
  "correlation_key" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_signals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_signals_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "ai_signals_priority_check" CHECK ("priority" BETWEEN 0 AND 100),
  CONSTRAINT "ai_signals_id_user_id_key" UNIQUE ("id", "user_id"),
  CONSTRAINT "ai_signals_user_deduplication_key" UNIQUE ("user_id", "deduplication_key"),
  CONSTRAINT "ai_signals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ai_signals_source_id_user_id_fkey" FOREIGN KEY ("source_id", "user_id") REFERENCES "ai_email_messages"("id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "ai_signal_evidence" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "signal_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "excerpt" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_signal_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_signal_evidence_source_key" UNIQUE ("signal_id", "source_type", "source_id"),
  CONSTRAINT "ai_signal_evidence_signal_id_user_id_fkey" FOREIGN KEY ("signal_id", "user_id") REFERENCES "ai_signals"("id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ai_signal_evidence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ai_signal_evidence_source_id_user_id_fkey" FOREIGN KEY ("source_id", "user_id") REFERENCES "ai_email_messages"("id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "ai_signals_user_detected_idx" ON "ai_signals"("user_id", "detected_at" DESC, "id");
CREATE INDEX "ai_signals_correlation_idx" ON "ai_signals"("correlation_key");
CREATE INDEX "ai_signal_evidence_user_signal_idx" ON "ai_signal_evidence"("user_id", "signal_id");

ALTER TABLE "ai_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_signal_evidence" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ai_signals", "ai_signal_evidence" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "ai_signals", "ai_signal_evidence" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "ai_signals", "ai_signal_evidence" FROM authenticated;
  END IF;
END $$;
