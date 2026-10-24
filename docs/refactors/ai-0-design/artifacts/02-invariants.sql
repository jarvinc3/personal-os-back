-- Non-Prisma CHECKs and partial indexes captured from the local migrated reference.

ALTER TABLE public."fin_accounts" ADD CONSTRAINT "fin_accounts_currency_iso_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

ALTER TABLE public."fin_accounts" ADD CONSTRAINT "fin_accounts_institution_required_check" CHECK ((institution_id IS NOT NULL));

ALTER TABLE public."fin_balance_drifts" ADD CONSTRAINT "fin_balance_drifts_target_check" CHECK ((num_nonnulls(account_id, card_id) = 1));

ALTER TABLE public."fin_budgets" ADD CONSTRAINT "fin_budgets_period_range_check" CHECK ((period_end >= period_start));

ALTER TABLE public."fin_card_balances" ADD CONSTRAINT "fin_card_balances_currency_iso_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

ALTER TABLE public."fin_cards" ADD CONSTRAINT "fin_cards_last_four_digits_check" CHECK (((last_four IS NULL) OR (last_four ~ '^[0-9]{4}$'::text)));

ALTER TABLE public."fin_cards" ADD CONSTRAINT "fin_cards_payment_day_check" CHECK (((payment_due_day IS NULL) OR ((payment_due_day >= 1) AND (payment_due_day <= 31))));

ALTER TABLE public."fin_cards" ADD CONSTRAINT "fin_cards_statement_day_check" CHECK (((statement_closing_day IS NULL) OR ((statement_closing_day >= 1) AND (statement_closing_day <= 31))));

ALTER TABLE public."fin_cards" ADD CONSTRAINT "fin_cards_type_account_check" CHECK ((((type = 'DEBIT'::"FinCardType") AND (account_id IS NOT NULL)) OR ((type = 'CREDIT'::"FinCardType") AND (account_id IS NULL))));

ALTER TABLE public."fin_institutions" ADD CONSTRAINT "fin_institutions_domain_check" CHECK (((domain IS NULL) OR (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'::text)));

ALTER TABLE public."fin_institutions" ADD CONSTRAINT "fin_institutions_type_check" CHECK ((type = ANY (ARRAY['bank'::text, 'credit_union'::text, 'digital_wallet'::text, 'broker'::text, 'cash'::text, 'other'::text])));

ALTER TABLE public."fin_loans" ADD CONSTRAINT "fin_loans_currency_iso_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

ALTER TABLE public."fin_receivables" ADD CONSTRAINT "fin_receivables_currency_iso_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

ALTER TABLE public."fin_reconciliations" ADD CONSTRAINT "fin_reconciliations_target_check" CHECK ((num_nonnulls(account_id, card_id) = 1));

ALTER TABLE public."fin_recurring_patterns" ADD CONSTRAINT "fin_recurring_patterns_currency_iso_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

ALTER TABLE public."fin_savings_goals" ADD CONSTRAINT "fin_savings_goals_currency_iso_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

ALTER TABLE public."fin_transactions" ADD CONSTRAINT "fin_transactions_account_xor_card_check" CHECK ((num_nonnulls(account_id, card_id) = 1));

ALTER TABLE public."fin_transactions" ADD CONSTRAINT "fin_transactions_currency_iso_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

CREATE UNIQUE INDEX fin_accounts_user_institution_default_key ON public.fin_accounts USING btree (user_id, institution_id) WHERE ((is_default_for_institution = true) AND (institution_id IS NOT NULL) AND (is_active = true));

CREATE UNIQUE INDEX fin_institutions_system_cash_user_key ON public.fin_institutions USING btree (user_id) WHERE ((type = 'cash'::text) AND (is_system = true));

CREATE UNIQUE INDEX fin_transactions_user_inst_ref_key ON public.fin_transactions USING btree (user_id, institution_id, external_reference) WHERE ((external_reference IS NOT NULL) AND (status <> 'REVERSED'::"FinTransactionStatus"));
