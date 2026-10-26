-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.
CREATE TABLE public.users (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    email text NOT NULL UNIQUE,
    full_name text NOT NULL,
    avatar_url text DEFAULT 'https://gravatar.com/avatar/8726036e65630332d43a0a229298a2a4?s=400&d=robohash&r=x'::text,
    timezone text NOT NULL DEFAULT 'America/Santo_Domingo'::text,
    locale text NOT NULL DEFAULT 'es-DO'::text,
    preferences jsonb NOT NULL DEFAULT '{"ai": {"tone": "balanced", "fieldGuide": "Comportamiento del agente en toda la app.", "defaultProvider": null, "proactiveInsights": true, "confirmBeforeActions": true}, "theme": {"value": "system", "fieldGuide": "Apariencia global (system | light | dark)."}, "privacy": {"fieldGuide": "Preferencias transversales de telemetría.", "analyticsEnabled": true, "crashReportsEnabled": true}, "version": 1, "onboarding": {"completed": false, "fieldGuide": "Flujo inicial de la app, no de un módulo."}, "notifications": {"channels": {"push": true, "email": false, "inApp": true}, "fieldGuide": "Cómo el usuario quiere recibir notificaciones.", "quietHours": {"end": "08:00", "start": "22:00", "enabled": true, "timezone": null}}}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT users_pkey PRIMARY KEY (id)
);
CREATE TABLE public.modules (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    key text NOT NULL UNIQUE,
    description text,
    CONSTRAINT modules_pkey PRIMARY KEY (id)
);
CREATE TABLE public.user_modules (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    module_id text NOT NULL,
    is_enabled boolean NOT NULL DEFAULT true,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT user_modules_pkey PRIMARY KEY (id),
    CONSTRAINT user_modules_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT user_modules_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id)
);
CREATE TABLE public.ai_agent_sessions (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    module_id text,
    context_type text NOT NULL DEFAULT 'general'::text,
    memory_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_active_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ai_agent_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT ai_agent_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT ai_agent_sessions_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id)
);
CREATE TABLE public.ai_messages (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    session_id text NOT NULL,
    role USER - DEFINED NOT NULL,
    content text NOT NULL,
    tool_calls jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    client_message_id text,
    CONSTRAINT ai_messages_pkey PRIMARY KEY (id),
    CONSTRAINT ai_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_agent_sessions(id)
);
CREATE TABLE public.ai_actions (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    session_id text NOT NULL,
    message_id text,
    action_type text NOT NULL,
    target_module text NOT NULL,
    payload jsonb NOT NULL,
    status USER - DEFINED NOT NULL DEFAULT 'PENDING'::"AiActionStatus",
    result jsonb,
    executed_at timestamp with time zone,
    CONSTRAINT ai_actions_pkey PRIMARY KEY (id),
    CONSTRAINT ai_actions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_agent_sessions(id),
    CONSTRAINT ai_actions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.ai_messages(id)
);
CREATE TABLE public.notifications (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    type text NOT NULL,
    channel USER - DEFINED NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_read boolean NOT NULL DEFAULT false,
    scheduled_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT notifications_pkey PRIMARY KEY (id),
    CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.push_tokens (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    platform text NOT NULL,
    token text NOT NULL UNIQUE,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT push_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.fin_accounts (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    name text NOT NULL,
    type USER - DEFINED NOT NULL,
    institution text,
    currency text NOT NULL DEFAULT 'DOP'::text,
    balance numeric NOT NULL DEFAULT 0,
    credit_limit numeric,
    statement_closing_day integer,
    payment_due_day integer,
    color text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    institution_id text,
    CONSTRAINT fin_accounts_pkey PRIMARY KEY (id),
    CONSTRAINT fin_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT fin_accounts_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES public.fin_institutions(id)
);
CREATE TABLE public.fin_email_sources (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    account_id text,
    provider text NOT NULL,
    email_address text NOT NULL,
    bank_domain text NOT NULL,
    access_token text,
    refresh_token text,
    imap_host text,
    last_synced_at timestamp with time zone,
    last_message_id text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    label text,
    token_expires_at timestamp with time zone,
    CONSTRAINT fin_email_sources_pkey PRIMARY KEY (id),
    CONSTRAINT fin_email_sources_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT fin_email_sources_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.fin_accounts(id)
);
CREATE TABLE public.fin_categories (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text,
    name text NOT NULL,
    icon text,
    color text,
    parent_id text,
    is_system boolean NOT NULL DEFAULT false,
    CONSTRAINT fin_categories_pkey PRIMARY KEY (id),
    CONSTRAINT fin_categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT fin_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.fin_categories(id)
);
CREATE TABLE public.fin_transactions (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    account_id text,
    user_id text NOT NULL,
    category_id text,
    email_message_id text UNIQUE,
    type USER - DEFINED NOT NULL,
    amount numeric NOT NULL,
    amount_base_currency numeric NOT NULL,
    currency text NOT NULL DEFAULT 'DOP'::text,
    exchange_rate numeric NOT NULL DEFAULT 1,
    merchant text,
    description text,
    transaction_date timestamp with time zone NOT NULL,
    status USER - DEFINED NOT NULL DEFAULT 'CONFIRMED'::"FinTransactionStatus",
    is_recurring boolean NOT NULL DEFAULT false,
    ai_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    notes text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    card_id text,
    source USER - DEFINED NOT NULL DEFAULT 'MANUAL'::"FinTransactionSource",
    transfer_group_id text,
    CONSTRAINT fin_transactions_pkey PRIMARY KEY (id),
    CONSTRAINT fin_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.fin_accounts(id),
    CONSTRAINT fin_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT fin_transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.fin_categories(id),
    CONSTRAINT fin_transactions_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.fin_cards(id)
);
CREATE TABLE public.fin_budgets (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    category_id text NOT NULL,
    amount_limit numeric NOT NULL,
    amount_spent numeric NOT NULL DEFAULT 0,
    alert_threshold_pct numeric NOT NULL DEFAULT 80,
    ai_suggestion_status USER - DEFINED NOT NULL DEFAULT 'NONE'::"AiSuggestionStatus",
    ai_suggestion_payload jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    period_type USER - DEFINED NOT NULL DEFAULT 'MONTHLY'::"FinBudgetPeriodType",
    period_start date NOT NULL DEFAULT CURRENT_DATE,
    period_end date NOT NULL DEFAULT CURRENT_DATE,
    CONSTRAINT fin_budgets_pkey PRIMARY KEY (id),
    CONSTRAINT fin_budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT fin_budgets_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.fin_categories(id)
);
CREATE TABLE public.fin_budget_alerts (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    budget_id text NOT NULL,
    type text NOT NULL,
    pct_used numeric NOT NULL,
    was_notified boolean NOT NULL DEFAULT false,
    triggered_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT fin_budget_alerts_pkey PRIMARY KEY (id),
    CONSTRAINT fin_budget_alerts_budget_id_fkey FOREIGN KEY (budget_id) REFERENCES public.fin_budgets(id)
);
CREATE TABLE public.fin_recurring_patterns (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    category_id text,
    merchant text NOT NULL,
    avg_amount numeric NOT NULL,
    currency text NOT NULL DEFAULT 'DOP'::text,
    frequency text NOT NULL,
    next_expected_date date NOT NULL,
    confidence_score integer NOT NULL DEFAULT 0,
    ai_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT fin_recurring_patterns_pkey PRIMARY KEY (id),
    CONSTRAINT fin_recurring_patterns_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT fin_recurring_patterns_category_fkey FOREIGN KEY (category_id) REFERENCES public.fin_categories(id)
);
CREATE TABLE public.fin_exchange_rates (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    from_currency text NOT NULL,
    to_currency text NOT NULL,
    rate numeric NOT NULL,
    rate_date date NOT NULL,
    CONSTRAINT fin_exchange_rates_pkey PRIMARY KEY (id)
);
CREATE TABLE public.fin_institutions (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    name text NOT NULL,
    color text,
    logo_url text,
    country text NOT NULL DEFAULT 'DO'::text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT fin_institutions_pkey PRIMARY KEY (id),
    CONSTRAINT fin_institutions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.fin_cards (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    institution_id text NOT NULL,
    account_id text,
    name text NOT NULL,
    last_four character,
    type USER - DEFINED NOT NULL,
    network USER - DEFINED,
    statement_closing_day integer,
    payment_due_day integer,
    color text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT fin_cards_pkey PRIMARY KEY (id),
    CONSTRAINT fin_cards_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT fin_cards_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES public.fin_institutions(id),
    CONSTRAINT fin_cards_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.fin_accounts(id)
);
CREATE TABLE public.fin_card_balances (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    card_id text NOT NULL,
    currency character NOT NULL,
    balance numeric NOT NULL DEFAULT 0,
    credit_limit numeric,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT fin_card_balances_pkey PRIMARY KEY (id),
    CONSTRAINT fin_card_balances_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.fin_cards(id)
);
CREATE TABLE public.fin_savings_goals (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    name text NOT NULL,
    description text,
    target_amount numeric NOT NULL,
    current_amount numeric NOT NULL DEFAULT 0,
    currency character NOT NULL DEFAULT 'DOP'::bpchar,
    target_date date,
    icon text,
    color text,
    is_completed boolean NOT NULL DEFAULT false,
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT fin_savings_goals_pkey PRIMARY KEY (id),
    CONSTRAINT fin_savings_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.fin_loans (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    account_id text,
    lender_name text NOT NULL,
    original_amount numeric NOT NULL,
    current_balance numeric NOT NULL,
    currency character NOT NULL DEFAULT 'DOP'::bpchar,
    installment_amount numeric NOT NULL,
    installment_freq USER - DEFINED NOT NULL,
    total_installments integer NOT NULL,
    paid_installments integer NOT NULL DEFAULT 0,
    next_due_date date NOT NULL,
    interest_rate numeric,
    notes text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT fin_loans_pkey PRIMARY KEY (id),
    CONSTRAINT fin_loans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT fin_loans_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.fin_accounts(id)
);
CREATE TABLE public.fin_receivables (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    debtor_name text NOT NULL,
    description text,
    amount numeric NOT NULL,
    paid_amount numeric NOT NULL DEFAULT 0,
    currency character NOT NULL DEFAULT 'DOP'::bpchar,
    due_date date,
    status USER - DEFINED NOT NULL DEFAULT 'PENDING'::"FinReceivableStatus",
    notes text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT fin_receivables_pkey PRIMARY KEY (id),
    CONSTRAINT fin_receivables_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.fin_email_sync_logs (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    source_id text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    emails_scanned integer NOT NULL DEFAULT 0,
    transactions_new integer NOT NULL DEFAULT 0,
    status USER - DEFINED NOT NULL DEFAULT 'RUNNING'::"FinEmailSyncStatus",
    error text,
    CONSTRAINT fin_email_sync_logs_pkey PRIMARY KEY (id),
    CONSTRAINT fin_email_sync_logs_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.fin_email_sources(id)
);
CREATE TABLE public.auth_deletion_outbox (
    id text NOT NULL DEFAULT (uuid_generate_v4())::text,
    user_id text NOT NULL,
    status USER - DEFINED NOT NULL DEFAULT 'PENDING'::auth_deletion_outbox_status,
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT auth_deletion_outbox_pkey PRIMARY KEY (id)
);