-- Read-only public link for a fixed set of receivables. A share carries an
-- opaque token; its items freeze the receivables chosen when it was created.
-- Revoking flips is_active and stamping revoked_at; regenerating swaps the
-- token so the previous URL stops resolving.

-- CreateTable
CREATE TABLE "fin_receivable_shares" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "debtor_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_receivable_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_receivable_share_items" (
    "share_id" TEXT NOT NULL,
    "receivable_id" TEXT NOT NULL,

    CONSTRAINT "fin_receivable_share_items_pkey" PRIMARY KEY ("share_id","receivable_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_receivable_shares_token_key" ON "fin_receivable_shares"("token");

-- CreateIndex
CREATE INDEX "fin_receivable_shares_user_id_idx" ON "fin_receivable_shares"("user_id");

-- CreateIndex
CREATE INDEX "fin_receivable_share_items_receivable_id_idx" ON "fin_receivable_share_items"("receivable_id");

-- AddForeignKey
ALTER TABLE "fin_receivable_shares" ADD CONSTRAINT "fin_receivable_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_receivable_share_items" ADD CONSTRAINT "fin_receivable_share_items_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "fin_receivable_shares"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_receivable_share_items" ADD CONSTRAINT "fin_receivable_share_items_receivable_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "fin_receivables"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- RLS on without policies: the API reaches these tables with the postgres role
-- (BYPASSRLS); Supabase's anon/authenticated roles get nothing.
ALTER TABLE "fin_receivable_shares" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_receivable_share_items" ENABLE ROW LEVEL SECURITY;
