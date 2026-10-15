-- CreateEnum
CREATE TYPE "fin_statement_line_type" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "fin_statement_import_status" AS ENUM ('PARSING', 'READY', 'APPLIED', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "fin_statement_line_decision" AS ENUM ('MATCH', 'CREATE', 'IGNORE');

-- CreateTable
CREATE TABLE "fin_statement_imports" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "user_id" TEXT NOT NULL,
    "card_id" TEXT,
    "account_id" TEXT,
    "statement_id" TEXT,
    "status" "fin_statement_import_status" NOT NULL DEFAULT 'PARSING',
    "parsed" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(6),

    CONSTRAINT "fin_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_statement_import_lines" (
    "id" TEXT NOT NULL DEFAULT (uuid_generate_v4())::text,
    "import_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "type" "fin_statement_line_type" NOT NULL,
    "reference" TEXT,
    "category_id" TEXT,
    "transaction_id" TEXT,
    "decision" "fin_statement_line_decision" NOT NULL DEFAULT 'CREATE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_statement_import_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_statement_imports_user_status_idx" ON "fin_statement_imports"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "fin_statement_imports_card_id_idx" ON "fin_statement_imports"("card_id");

-- CreateIndex
CREATE INDEX "fin_statement_imports_account_id_idx" ON "fin_statement_imports"("account_id");

-- CreateIndex
CREATE INDEX "fin_statement_import_lines_import_date_idx" ON "fin_statement_import_lines"("import_id", "date");

-- CreateIndex
CREATE INDEX "fin_statement_import_lines_transaction_idx" ON "fin_statement_import_lines"("transaction_id");

-- AddForeignKey
ALTER TABLE "fin_statement_imports" ADD CONSTRAINT "fin_statement_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_statement_imports" ADD CONSTRAINT "fin_statement_imports_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_statement_imports" ADD CONSTRAINT "fin_statement_imports_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_statement_imports" ADD CONSTRAINT "fin_statement_imports_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "fin_card_statements"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_statement_import_lines" ADD CONSTRAINT "fin_statement_import_lines_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "fin_statement_imports"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_statement_import_lines" ADD CONSTRAINT "fin_statement_import_lines_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

