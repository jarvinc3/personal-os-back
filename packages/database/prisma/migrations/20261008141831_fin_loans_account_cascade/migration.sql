-- DropForeignKey
ALTER TABLE "fin_loans" DROP CONSTRAINT "fin_loans_account_id_fkey";

-- AddForeignKey
ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
