-- CreateEnum
CREATE TYPE "fin_signal_import_resolution_action" AS ENUM (
  'SET_DATE',
  'SET_DESTINATION',
  'LINK_REVERSAL',
  'DISCARD'
);

-- AlterEnum
ALTER TYPE "fin_signal_import_status" ADD VALUE 'DISMISSED';

-- CreateTable
CREATE TABLE "fin_signal_import_resolutions" (
  "id" TEXT NOT NULL DEFAULT (extensions.uuid_generate_v4())::text,
  "user_id" TEXT NOT NULL,
  "signal_import_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "action" "fin_signal_import_resolution_action" NOT NULL,
  "outcome" TEXT NOT NULL,
  "reason" TEXT,
  "changes" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fin_signal_import_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_signal_import_resolutions_import_idx" ON "fin_signal_import_resolutions" ("signal_import_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "fin_signal_import_resolutions_user_created_idx" ON "fin_signal_import_resolutions" ("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "fin_signal_import_resolutions" ADD CONSTRAINT "fin_signal_import_resolutions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_signal_import_resolutions" ADD CONSTRAINT "fin_signal_import_resolutions_signal_import_id_fkey" FOREIGN KEY ("signal_import_id") REFERENCES "fin_signal_imports" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
