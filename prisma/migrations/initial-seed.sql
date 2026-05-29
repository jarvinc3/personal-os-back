-- ============================================================
-- Personal App — Schema SQL para Supabase
-- Generado desde: prisma/schema.prisma
-- Ejecutar en: Supabase > SQL Editor > New query
-- ============================================================
-- Extensión para uuid_generate_v4()
create extension IF not exists "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================
create type "AiRole" as ENUM('user', 'assistant', 'tool');

create type "AiActionStatus" as ENUM(
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED'
);

create type "NotificationChannel" as ENUM('PUSH', 'IN_APP', 'EMAIL');

create type "FinAccountType" as ENUM(
  'CHECKING',
  'SAVINGS',
  'CREDIT_CARD',
  'CASH',
  'INVESTMENT'
);

create type "FinTransactionType" as ENUM('DEBIT', 'CREDIT', 'TRANSFER');

create type "FinTransactionStatus" as ENUM('PENDING', 'CONFIRMED', 'CANCELLED');

create type "AiSuggestionStatus" as ENUM('NONE', 'PENDING', 'ACCEPTED', 'REJECTED');

-- ============================================================
-- CORE — Usuarios y Módulos
-- ============================================================
create table users (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  email TEXT not null,
  full_name TEXT not null,
  avatar_url TEXT,
  timezone TEXT not null default 'America/Santo_Domingo',
  locale TEXT not null default 'es-DO',
  preferences JSONB not null default '{}',
  created_at TIMESTAMPTZ not null default NOW(),
  updated_at TIMESTAMPTZ not null default NOW(),
  constraint users_pkey primary key (id),
  constraint users_email_key unique (email)
);

create table modules (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  slug TEXT not null,
  name TEXT not null,
  is_active BOOLEAN not null default true,
  sort_order INTEGER not null default 0,
  constraint modules_pkey primary key (id),
  constraint modules_slug_key unique (slug)
);

create table user_modules (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  user_id TEXT not null,
  module_id TEXT not null,
  is_enabled BOOLEAN not null default true,
  config JSONB not null default '{}',
  enabled_at TIMESTAMPTZ not null default NOW(),
  constraint user_modules_pkey primary key (id),
  constraint user_modules_user_id_module_id_key unique (user_id, module_id),
  constraint user_modules_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE,
  constraint user_modules_module_id_fkey foreign KEY (module_id) references modules (id)
);

-- ============================================================
-- AGENTE IA
-- ============================================================
create table ai_agent_sessions (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  user_id TEXT not null,
  module_id TEXT,
  context_type TEXT not null default 'general',
  memory_snapshot JSONB not null default '{}',
  last_active_at TIMESTAMPTZ not null default NOW(),
  created_at TIMESTAMPTZ not null default NOW(),
  constraint ai_agent_sessions_pkey primary key (id),
  constraint ai_agent_sessions_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE,
  constraint ai_agent_sessions_module_id_fkey foreign KEY (module_id) references modules (id)
);

create table ai_messages (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  session_id TEXT not null,
  role "AiRole" not null,
  content TEXT not null,
  tool_calls JSONB,
  metadata JSONB not null default '{}',
  created_at TIMESTAMPTZ not null default NOW(),
  constraint ai_messages_pkey primary key (id),
  constraint ai_messages_session_id_fkey foreign KEY (session_id) references ai_agent_sessions (id) on delete CASCADE
);

create table ai_actions (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  session_id TEXT not null,
  message_id TEXT,
  action_type TEXT not null,
  target_module TEXT not null,
  payload JSONB not null,
  status "AiActionStatus" not null default 'PENDING',
  result JSONB,
  executed_at TIMESTAMPTZ,
  constraint ai_actions_pkey primary key (id),
  constraint ai_actions_session_id_fkey foreign KEY (session_id) references ai_agent_sessions (id) on delete CASCADE,
  constraint ai_actions_message_id_fkey foreign KEY (message_id) references ai_messages (id)
);

-- ============================================================
-- NOTIFICACIONES
-- ============================================================
create table notifications (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  user_id TEXT not null,
  type TEXT not null,
  channel "NotificationChannel" not null,
  title TEXT not null,
  body TEXT not null,
  data JSONB not null default '{}',
  is_read BOOLEAN not null default false,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ not null default NOW(),
  constraint notifications_pkey primary key (id),
  constraint notifications_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE
);

create index notifications_user_id_is_read_idx on notifications (user_id, is_read);

create index notifications_scheduled_at_idx on notifications (scheduled_at);

create table push_tokens (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  user_id TEXT not null,
  platform TEXT not null,
  token TEXT not null,
  is_active BOOLEAN not null default true,
  created_at TIMESTAMPTZ not null default NOW(),
  constraint push_tokens_pkey primary key (id),
  constraint push_tokens_token_key unique (token),
  constraint push_tokens_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE
);

-- ============================================================
-- MÓDULO FINANZAS
-- ============================================================
create table fin_accounts (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  user_id TEXT not null,
  name TEXT not null,
  type "FinAccountType" not null,
  institution TEXT,
  currency TEXT not null default 'DOP',
  balance DECIMAL(15, 2) not null default 0,
  credit_limit DECIMAL(15, 2),
  statement_closing_day INTEGER,
  payment_due_day INTEGER,
  color TEXT,
  is_active BOOLEAN not null default true,
  created_at TIMESTAMPTZ not null default NOW(),
  updated_at TIMESTAMPTZ not null default NOW(),
  constraint fin_accounts_pkey primary key (id),
  constraint fin_accounts_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE
);

create table fin_email_sources (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  user_id TEXT not null,
  account_id TEXT,
  provider TEXT not null,
  email_address TEXT not null,
  bank_domain TEXT not null,
  access_token TEXT,
  refresh_token TEXT,
  imap_host TEXT,
  last_synced_at TIMESTAMPTZ,
  last_message_id TEXT,
  is_active BOOLEAN not null default true,
  created_at TIMESTAMPTZ not null default NOW(),
  constraint fin_email_sources_pkey primary key (id),
  constraint fin_email_sources_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE,
  constraint fin_email_sources_account_id_fkey foreign KEY (account_id) references fin_accounts (id)
);

create table fin_categories (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  user_id TEXT,
  name TEXT not null,
  icon TEXT,
  color TEXT,
  parent_id TEXT,
  is_system BOOLEAN not null default false,
  constraint fin_categories_pkey primary key (id),
  constraint fin_categories_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE,
  constraint fin_categories_parent_id_fkey foreign KEY (parent_id) references fin_categories (id)
);

create table fin_transactions (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  account_id TEXT not null,
  user_id TEXT not null,
  category_id TEXT,
  email_message_id TEXT,
  type "FinTransactionType" not null,
  amount DECIMAL(15, 2) not null,
  amount_base_currency DECIMAL(15, 2) not null,
  currency TEXT not null default 'DOP',
  exchange_rate DECIMAL(10, 6) not null default 1,
  merchant TEXT,
  description TEXT,
  transaction_date DATE not null,
  status "FinTransactionStatus" not null default 'CONFIRMED',
  is_recurring BOOLEAN not null default false,
  ai_metadata JSONB not null default '{}',
  notes TEXT,
  created_at TIMESTAMPTZ not null default NOW(),
  updated_at TIMESTAMPTZ not null default NOW(),
  constraint fin_transactions_pkey primary key (id),
  constraint fin_transactions_email_message_id_key unique (email_message_id),
  constraint fin_transactions_account_id_fkey foreign KEY (account_id) references fin_accounts (id) on delete CASCADE,
  constraint fin_transactions_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE,
  constraint fin_transactions_category_id_fkey foreign KEY (category_id) references fin_categories (id)
);

create index fin_transactions_user_id_date_idx on fin_transactions (user_id, transaction_date);

create index fin_transactions_account_id_date_idx on fin_transactions (account_id, transaction_date);

create index fin_transactions_user_id_category_idx on fin_transactions (user_id, category_id);

create table fin_budgets (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  user_id TEXT not null,
  category_id TEXT not null,
  year INTEGER not null,
  month INTEGER not null,
  amount_limit DECIMAL(15, 2) not null,
  amount_spent DECIMAL(15, 2) not null default 0,
  alert_threshold_pct DECIMAL(5, 2) not null default 80,
  ai_suggestion_status "AiSuggestionStatus" not null default 'NONE',
  ai_suggestion_payload JSONB,
  created_at TIMESTAMPTZ not null default NOW(),
  constraint fin_budgets_pkey primary key (id),
  constraint fin_budgets_user_category_year_month_key unique (user_id, category_id, year, month),
  constraint fin_budgets_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE,
  constraint fin_budgets_category_id_fkey foreign KEY (category_id) references fin_categories (id)
);

create table fin_budget_alerts (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  budget_id TEXT not null,
  type TEXT not null,
  pct_used DECIMAL(5, 2) not null,
  was_notified BOOLEAN not null default false,
  triggered_at TIMESTAMPTZ not null default NOW(),
  constraint fin_budget_alerts_pkey primary key (id),
  constraint fin_budget_alerts_budget_id_fkey foreign KEY (budget_id) references fin_budgets (id) on delete CASCADE
);

create table fin_recurring_patterns (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  user_id TEXT not null,
  category_id TEXT,
  merchant TEXT not null,
  avg_amount DECIMAL(15, 2) not null,
  currency TEXT not null default 'DOP',
  frequency TEXT not null,
  next_expected_date DATE not null,
  confidence_score INTEGER not null default 0,
  ai_analysis JSONB not null default '{}',
  is_active BOOLEAN not null default true,
  updated_at TIMESTAMPTZ not null default NOW(),
  constraint fin_recurring_patterns_pkey primary key (id),
  constraint fin_recurring_patterns_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE,
  constraint fin_recurring_patterns_category_fkey foreign KEY (category_id) references fin_categories (id)
);

create table fin_exchange_rates (
  id TEXT not null default uuid_generate_v4 ()::TEXT,
  from_currency TEXT not null,
  to_currency TEXT not null,
  rate DECIMAL(15, 6) not null,
  rate_date DATE not null,
  constraint fin_exchange_rates_pkey primary key (id),
  constraint fin_exchange_rates_from_to_date_key unique (from_currency, to_currency, rate_date)
);

create index fin_exchange_rates_from_to_idx on fin_exchange_rates (from_currency, to_currency);

-- ============================================================
-- TRIGGER: updated_at automático
-- ============================================================
create or replace function update_updated_at () RETURNS TRIGGER as $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

create trigger trg_users_updated_at BEFORE
update on users for EACH row
execute FUNCTION update_updated_at ();

create trigger trg_fin_accounts_updated_at BEFORE
update on fin_accounts for EACH row
execute FUNCTION update_updated_at ();

create trigger trg_fin_transactions_updated_at BEFORE
update on fin_transactions for EACH row
execute FUNCTION update_updated_at ();

create trigger trg_fin_recurring_updated_at BEFORE
update on fin_recurring_patterns for EACH row
execute FUNCTION update_updated_at ();

-- ============================================================
-- SEED: Módulos del sistema
-- ============================================================
insert into
  modules (id, slug, name, is_active, sort_order)
values
  (
    uuid_generate_v4 ()::TEXT,
    'finance',
    'Finanzas',
    true,
    1
  ),
  (
    uuid_generate_v4 ()::TEXT,
    'agenda',
    'Agenda',
    true,
    2
  ),
  (
    uuid_generate_v4 ()::TEXT,
    'projects',
    'Proyectos',
    true,
    3
  ),
  (
    uuid_generate_v4 ()::TEXT,
    'subscriptions',
    'Suscripciones',
    true,
    4
  ),
  (
    uuid_generate_v4 ()::TEXT,
    'health',
    'Salud',
    true,
    5
  )
on conflict (slug) do nothing;

-- ============================================================
-- SEED: Categorías del sistema (jerarquía padre → hijo)
-- ============================================================
-- Categorías padre con IDs fijos para referenciarlos en subcategorías
insert into
    fin_categories (
        id,
        name,
        icon,
        color,
        is_system,
        user_id
    )
values (
        'system-alimentacion',
        'Alimentación',
        '🍽️',
        '#E85D24',
        true,
        null
    ),
    (
        'system-transporte',
        'Transporte',
        '🚗',
        '#3B8BD4',
        true,
        null
    ),
    (
        'system-hogar',
        'Hogar',
        '🏠',
        '#1D9E75',
        true,
        null
    ),
    (
        'system-salud',
        'Salud',
        '💊',
        '#D4537E',
        true,
        null
    ),
    (
        'system-entretenimiento',
        'Entretenimiento',
        '🎬',
        '#7F77DD',
        true,
        null
    ),
    (
        'system-ropa',
        'Ropa y calzado',
        '👕',
        '#EF9F27',
        true,
        null
    ),
    (
        'system-educacion',
        'Educación',
        '📚',
        '#639922',
        true,
        null
    ),
    (
        'system-suscripciones',
        'Suscripciones',
        '📱',
        '#534AB7',
        true,
        null
    ),
    (
        'system-ingresos',
        'Ingresos',
        '💰',
        '#0F6E56',
        true,
        null
    ),
    (
        'system-transferencias',
        'Transferencias',
        '🔄',
        '#888780',
        true,
        null
    ),
    (
        'system-otros',
        'Otros',
        '📦',
        '#5F5E5A',
        true,
        null
    ) on conflict (id) do nothing;

-- Subcategorías
insert into
    fin_categories (
        id,
        name,
        icon,
        is_system,
        user_id,
        parent_id
    )
values
    -- Alimentación
    (
        'system-supermercado',
        'Supermercado',
        '🛒',
        true,
        null,
        'system-alimentacion'
    ),
    (
        'system-restaurantes',
        'Restaurantes',
        '🍴',
        true,
        null,
        'system-alimentacion'
    ),
    (
        'system-delivery',
        'Delivery',
        '🛵',
        true,
        null,
        'system-alimentacion'
    ),
    (
        'system-cafeteria',
        'Cafetería',
        '☕',
        true,
        null,
        'system-alimentacion'
    ),
    -- Transporte
    (
        'system-gasolina',
        'Gasolina',
        '⛽',
        true,
        null,
        'system-transporte'
    ),
    (
        'system-taxi-uber',
        'Taxi / Uber',
        '🚕',
        true,
        null,
        'system-transporte'
    ),
    (
        'system-parking',
        'Estacionamiento',
        '🅿️',
        true,
        null,
        'system-transporte'
    ),
    -- Hogar
    (
        'system-alquiler',
        'Alquiler',
        '🏡',
        true,
        null,
        'system-hogar'
    ),
    (
        'system-servicios',
        'Servicios',
        '💡',
        true,
        null,
        'system-hogar'
    ),
    (
        'system-internet',
        'Internet',
        '📶',
        true,
        null,
        'system-hogar'
    ),
    -- Entretenimiento
    (
        'system-streaming',
        'Streaming',
        '📺',
        true,
        null,
        'system-entretenimiento'
    ),
    (
        'system-salidas',
        'Salidas',
        '🎉',
        true,
        null,
        'system-entretenimiento'
    ),
    (
        'system-viajes',
        'Viajes',
        '✈️',
        true,
        null,
        'system-entretenimiento'
    ),
    -- Ingresos
    (
        'system-salario',
        'Salario',
        '💼',
        true,
        null,
        'system-ingresos'
    ),
    (
        'system-freelance',
        'Freelance',
        '💻',
        true,
        null,
        'system-ingresos'
    ),
    (
        'system-inversiones',
        'Inversiones',
        '📈',
        true,
        null,
        'system-ingresos'
    ) on conflict (id) do nothing;

-- ============================================================
-- SEED: Tipos de cambio iniciales (referencia — actualizar vía cron)
-- ============================================================
insert into
  fin_exchange_rates (id, from_currency, to_currency, rate, rate_date)
values
  (
    uuid_generate_v4 ()::TEXT,
    'USD',
    'DOP',
    60.50,
    CURRENT_DATE
  ),
  (
    uuid_generate_v4 ()::TEXT,
    'EUR',
    'DOP',
    65.80,
    CURRENT_DATE
  ),
  (
    uuid_generate_v4 ()::TEXT,
    'DOP',
    'USD',
    0.016529,
    CURRENT_DATE
  ),
  (
    uuid_generate_v4 ()::TEXT,
    'USD',
    'EUR',
    0.920000,
    CURRENT_DATE
  )
on conflict (from_currency, to_currency, rate_date) do nothing;

-- ============================================================
-- ROW LEVEL SECURITY (Supabase)
-- Cada usuario solo accede a sus propios datos.
-- ============================================================
alter table users ENABLE row LEVEL SECURITY;

alter table user_modules ENABLE row LEVEL SECURITY;

alter table ai_agent_sessions ENABLE row LEVEL SECURITY;

alter table ai_messages ENABLE row LEVEL SECURITY;

alter table ai_actions ENABLE row LEVEL SECURITY;

alter table notifications ENABLE row LEVEL SECURITY;

alter table push_tokens ENABLE row LEVEL SECURITY;

alter table fin_accounts ENABLE row LEVEL SECURITY;

alter table fin_email_sources ENABLE row LEVEL SECURITY;

alter table fin_transactions ENABLE row LEVEL SECURITY;

alter table fin_categories ENABLE row LEVEL SECURITY;

alter table fin_budgets ENABLE row LEVEL SECURITY;

alter table fin_budget_alerts ENABLE row LEVEL SECURITY;

alter table fin_recurring_patterns ENABLE row LEVEL SECURITY;

-- users: cada quien ve solo su fila
create policy "users: own row" on users using (id = auth.uid ()::TEXT);

-- user_modules
create policy "user_modules: own" on user_modules using (user_id = auth.uid ()::TEXT);

-- ai_agent_sessions
create policy "ai_sessions: own" on ai_agent_sessions using (user_id = auth.uid ()::TEXT);

-- ai_messages (acceso vía sesión propia)
create policy "ai_messages: own sessions" on ai_messages using (
  session_id in (
    select
      id
    from
      ai_agent_sessions
    where
      user_id = auth.uid ()::TEXT
  )
);

-- ai_actions
create policy "ai_actions: own sessions" on ai_actions using (
  session_id in (
    select
      id
    from
      ai_agent_sessions
    where
      user_id = auth.uid ()::TEXT
  )
);

-- notifications
create policy "notifications: own" on notifications using (user_id = auth.uid ()::TEXT);

-- push_tokens
create policy "push_tokens: own" on push_tokens using (user_id = auth.uid ()::TEXT);

-- fin_accounts
create policy "fin_accounts: own" on fin_accounts using (user_id = auth.uid ()::TEXT);

-- fin_email_sources
create policy "fin_email_sources: own" on fin_email_sources using (user_id = auth.uid ()::TEXT);

-- fin_transactions
create policy "fin_transactions: own" on fin_transactions using (user_id = auth.uid ()::TEXT);

-- fin_categories: propias + sistema
create policy "fin_categories: own or system" on fin_categories using (
  user_id = auth.uid ()::TEXT
  or is_system = true
);

-- fin_budgets
create policy "fin_budgets: own" on fin_budgets using (user_id = auth.uid ()::TEXT);

-- fin_budget_alerts (acceso vía presupuesto propio)
create policy "fin_budget_alerts: own budgets" on fin_budget_alerts using (
  budget_id in (
    select
      id
    from
      fin_budgets
    where
      user_id = auth.uid ()::TEXT
  )
);

-- fin_recurring_patterns
create policy "fin_recurring: own" on fin_recurring_patterns using (user_id = auth.uid ()::TEXT);

-- fin_exchange_rates: lectura pública (no tiene user_id)
alter table fin_exchange_rates ENABLE row LEVEL SECURITY;

create policy "fin_exchange_rates: public read" on fin_exchange_rates for
select using (true);

-- modules: lectura pública
alter table modules ENABLE row LEVEL SECURITY;

create policy "modules: public read" on modules for
select using (true);
