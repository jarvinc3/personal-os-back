-- DropForeignKey
ALTER TABLE "fin_accounts" DROP CONSTRAINT "fin_accounts_institution_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_budgets" DROP CONSTRAINT "fin_budgets_category_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_cards" DROP CONSTRAINT "fin_cards_account_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_cards" DROP CONSTRAINT "fin_cards_institution_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_categories" DROP CONSTRAINT "fin_categories_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_email_sources" DROP CONSTRAINT "fin_email_sources_institution_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_loans" DROP CONSTRAINT "fin_loans_institution_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_transactions" DROP CONSTRAINT "fin_transactions_account_id_fkey";

-- DropForeignKey
ALTER TABLE "fin_transactions" DROP CONSTRAINT "fin_transactions_card_id_fkey";

-- AddForeignKey
ALTER TABLE "fin_accounts" ADD CONSTRAINT "fin_accounts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_email_sources" ADD CONSTRAINT "fin_email_sources_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "fin_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_categories" ADD CONSTRAINT "fin_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "fin_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_budgets" ADD CONSTRAINT "fin_budgets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_cards" ADD CONSTRAINT "fin_cards_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_cards" ADD CONSTRAINT "fin_cards_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
