-- CreateEnum
CREATE TYPE "auth_deletion_outbox_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "auth_deletion_outbox" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "status" "auth_deletion_outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_deletion_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_deletion_outbox_user_id_key" ON "auth_deletion_outbox"("user_id");

-- CreateIndex
CREATE INDEX "auth_deletion_outbox_status_next_attempt_idx" ON "auth_deletion_outbox"("status", "next_attempt_at");
