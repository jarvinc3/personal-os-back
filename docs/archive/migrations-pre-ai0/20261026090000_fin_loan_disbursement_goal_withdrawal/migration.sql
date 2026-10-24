-- Loan aliases and the account that received the disbursed principal. The
-- movement is an ADJUSTMENT, so the money raises the account without counting
-- as monthly income. A goal withdrawal records the destination account and
-- moves the money with a transfer.
ALTER TABLE "fin_loans" ADD COLUMN     "disbursement_account_id" TEXT,
ADD COLUMN     "disbursement_transaction_id" TEXT,
ADD COLUMN     "name" TEXT;

ALTER TABLE "fin_savings_goal_contributions" ADD COLUMN     "destination_account_id" TEXT;

CREATE UNIQUE INDEX "fin_loans_disbursement_transaction_id_key" ON "fin_loans"("disbursement_transaction_id");

CREATE INDEX "fin_loans_disbursement_account_id_idx" ON "fin_loans"("disbursement_account_id");

CREATE INDEX "fin_savings_goal_contributions_destination_account_id_idx" ON "fin_savings_goal_contributions"("destination_account_id");

ALTER TABLE "fin_savings_goal_contributions" ADD CONSTRAINT "fin_savings_goal_contributions_destination_account_id_fkey" FOREIGN KEY ("destination_account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_disbursement_account_id_fkey" FOREIGN KEY ("disbursement_account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_disbursement_transaction_id_fkey" FOREIGN KEY ("disbursement_transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
