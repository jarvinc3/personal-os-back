-- Fecha real de creación: 2026-10-24. Ordena después de la última migración
-- existente (20261101090000); no se modifica ninguna migración aplicada.
ALTER TABLE "domain_event_outbox" ADD COLUMN "claimed_at" TIMESTAMPTZ(6);
CREATE INDEX "domain_event_outbox_status_claimed_at_idx"
  ON "domain_event_outbox" ("status", "claimed_at");
