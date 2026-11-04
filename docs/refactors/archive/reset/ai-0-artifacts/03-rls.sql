-- RLS is enabled even though public app tables are closed to the Data API.

ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."modules" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."user_modules" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."ai_actions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."push_tokens" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_accounts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_transactions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_categories" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_budgets" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_budget_categories" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_budget_alerts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_recurring_patterns" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_merchants" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_merchant_duplicate_dismissals" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_merchant_aliases" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_subscriptions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_subscription_payments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_subscription_alert_dismissals" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_exchange_rates" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_institutions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_cards" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_card_balances" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_instrument_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_card_statements" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_savings_goals" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_savings_goal_contributions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_loans" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_loan_installments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_loan_prepayments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_receivables" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_receivable_shares" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_receivable_share_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_receivable_payments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."domain_event_outbox" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."processed_domain_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."auth_deletion_outbox" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_deletion_journal" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_statement_imports" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_statement_import_lines" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_reconciliations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_reconciliation_adjustments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."fin_balance_drifts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."idempotency_keys" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_actions_all_own" ON public."ai_actions" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (SELECT auth.uid())::text)) WITH CHECK ((user_id = (SELECT auth.uid())::text));

CREATE POLICY "fin_accounts_all_own" ON public."fin_accounts" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "fin_budget_alerts_all_own" ON public."fin_budget_alerts" AS PERMISSIVE FOR ALL TO "authenticated" USING ((budget_id IN ( SELECT b.id
   FROM fin_budgets b
  WHERE (b.user_id = (( SELECT auth.uid() AS uid))::text)))) WITH CHECK ((budget_id IN ( SELECT b.id
   FROM fin_budgets b
  WHERE (b.user_id = (( SELECT auth.uid() AS uid))::text))));

CREATE POLICY "fin_budgets_all_own" ON public."fin_budgets" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "fin_card_balances_all_own" ON public."fin_card_balances" AS PERMISSIVE FOR ALL TO "authenticated" USING ((card_id IN ( SELECT c.id
   FROM fin_cards c
  WHERE (c.user_id = (( SELECT auth.uid() AS uid))::text)))) WITH CHECK ((card_id IN ( SELECT c.id
   FROM fin_cards c
  WHERE (c.user_id = (( SELECT auth.uid() AS uid))::text))));

CREATE POLICY "fin_cards_all_own" ON public."fin_cards" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "fin_categories_delete_own" ON public."fin_categories" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((user_id = (( SELECT auth.uid() AS uid))::text) AND (is_system = false)));

CREATE POLICY "fin_categories_insert_own" ON public."fin_categories" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((user_id = (( SELECT auth.uid() AS uid))::text) AND (is_system = false)));

CREATE POLICY "fin_categories_select_own_or_system" ON public."fin_categories" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((user_id = (( SELECT auth.uid() AS uid))::text) OR (is_system = true)));

CREATE POLICY "fin_categories_update_own" ON public."fin_categories" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((user_id = (( SELECT auth.uid() AS uid))::text) AND (is_system = false))) WITH CHECK (((user_id = (( SELECT auth.uid() AS uid))::text) AND (is_system = false)));

CREATE POLICY "fin_exchange_rates_select_public" ON public."fin_exchange_rates" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "fin_institutions_all_own" ON public."fin_institutions" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "fin_loans_all_own" ON public."fin_loans" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "fin_receivables_all_own" ON public."fin_receivables" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "fin_recurring_all_own" ON public."fin_recurring_patterns" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "fin_savings_goals_all_own" ON public."fin_savings_goals" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "fin_transactions_all_own" ON public."fin_transactions" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "modules_select_public" ON public."modules" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "notifications_all_own" ON public."notifications" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "push_tokens_all_own" ON public."push_tokens" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "user_modules_all_own" ON public."user_modules" AS PERMISSIVE FOR ALL TO "authenticated" USING ((user_id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((user_id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "users_select_own" ON public."users" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((id = (( SELECT auth.uid() AS uid))::text));

CREATE POLICY "users_update_own" ON public."users" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((id = (( SELECT auth.uid() AS uid))::text)) WITH CHECK ((id = (( SELECT auth.uid() AS uid))::text));
