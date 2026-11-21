-- AlterTable
ALTER TABLE "auth_deletion_outbox"
  ADD COLUMN "claimed_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "auth_deletion_outbox_status_claimed_at_idx" ON "auth_deletion_outbox"("status", "claimed_at");
