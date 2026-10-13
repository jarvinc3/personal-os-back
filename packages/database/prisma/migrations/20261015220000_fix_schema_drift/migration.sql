-- DropForeignKey
ALTER TABLE "fin_loan_prepayments" DROP CONSTRAINT "fin_loan_prepayments_loan_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_loan_prepayments" DROP CONSTRAINT "fin_loan_prepayments_transaction_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_savings_goals" DROP CONSTRAINT "fin_savings_goals_account_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "fin_budgets_user_category_period_key";

-- CreateIndex
CREATE UNIQUE INDEX "fin_email_messages_source_fingerprint_key" ON "fin_email_messages"("source_id", "fingerprint");

-- AddForeignKey
ALTER TABLE "fin_savings_goals" ADD CONSTRAINT "fin_savings_goals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_loan_prepayments" ADD CONSTRAINT "fin_loan_prepayments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "fin_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_loan_prepayments" ADD CONSTRAINT "fin_loan_prepayments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

