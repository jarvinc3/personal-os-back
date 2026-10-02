-- Align institution foreign keys with schema.prisma (drift in the shared database).
ALTER TABLE "fin_accounts" DROP CONSTRAINT "fin_accounts_institution_id_fkey";
ALTER TABLE "fin_cards" DROP CONSTRAINT "fin_cards_institution_id_fkey";
ALTER TABLE "fin_loans" DROP CONSTRAINT "fin_loans_institution_id_fkey";

ALTER TABLE "fin_accounts" ADD CONSTRAINT "fin_accounts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "fin_cards" ADD CONSTRAINT "fin_cards_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "fin_institutions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
