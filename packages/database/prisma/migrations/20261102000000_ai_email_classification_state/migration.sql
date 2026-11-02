-- Creada el 2026-11-02 para reclamar mensajes durante clasificación en AI-5.
ALTER TYPE "ai_email_processing_status" ADD VALUE IF NOT EXISTS 'CLASSIFYING';

ALTER TABLE "ai_email_messages"
  ADD COLUMN "classification_started_at" TIMESTAMPTZ(6);
