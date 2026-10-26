-- Link a savings goal contribution to the account the money left and the
-- movement it created, mirroring fin_receivable_payments.

ALTER TABLE "fin_savings_goal_contributions" ADD COLUMN "account_id" TEXT;
ALTER TABLE "fin_savings_goal_contributions" ADD COLUMN "transaction_id" TEXT;

CREATE UNIQUE INDEX "fin_savings_goal_contributions_transaction_id_key" ON "fin_savings_goal_contributions"("transaction_id");
CREATE INDEX "fin_savings_goal_contributions_account_id_idx" ON "fin_savings_goal_contributions"("account_id");

ALTER TABLE "fin_savings_goal_contributions" ADD CONSTRAINT "fin_savings_goal_contributions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "fin_savings_goal_contributions" ADD CONSTRAINT "fin_savings_goal_contributions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "fin_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
