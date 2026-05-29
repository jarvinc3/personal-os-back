-- Finance migration 3: loans + receivables + email sync logs + categories extension

create type "FinInstallmentFreq" as enum ('WEEKLY', 'BIWEEKLY', 'MONTHLY');
create type "FinReceivableStatus" as enum ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED');
create type "FinEmailSyncStatus" as enum ('RUNNING', 'SUCCESS', 'FAILED');

alter table fin_email_sources add column label text;
alter table fin_email_sources add column token_expires_at timestamptz;
create index fin_email_sources_user_id_active_idx on fin_email_sources(user_id, is_active);

create table fin_loans (
  id text primary key default uuid_generate_v4()::text,
  user_id text not null references users(id) on delete cascade,
  account_id text references fin_accounts(id),
  lender_name text not null,
  original_amount decimal(15,2) not null,
  current_balance decimal(15,2) not null,
  currency char(3) not null default 'DOP',
  installment_amount decimal(15,2) not null,
  installment_freq "FinInstallmentFreq" not null,
  total_installments integer not null,
  paid_installments integer not null default 0,
  next_due_date date not null,
  interest_rate decimal(5,4),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table fin_receivables (
  id text primary key default uuid_generate_v4()::text,
  user_id text not null references users(id) on delete cascade,
  debtor_name text not null,
  description text,
  amount decimal(15,2) not null,
  paid_amount decimal(15,2) not null default 0,
  currency char(3) not null default 'DOP',
  due_date date,
  status "FinReceivableStatus" not null default 'PENDING',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table fin_email_sync_logs (
  id text primary key default uuid_generate_v4()::text,
  source_id text not null references fin_email_sources(id) on delete cascade,
  started_at timestamptz not null,
  completed_at timestamptz,
  emails_scanned integer not null default 0,
  transactions_new integer not null default 0,
  status "FinEmailSyncStatus" not null default 'RUNNING',
  error text
);

create index fin_loans_user_id_active_due_idx on fin_loans(user_id, is_active, next_due_date);
create index fin_receivables_user_status_idx on fin_receivables(user_id, status);
create index fin_email_sync_logs_source_started_idx on fin_email_sync_logs(source_id, started_at);

alter table fin_loans enable row level security;
create policy "fin_loans: own" on fin_loans using (user_id = auth.uid()::text);

alter table fin_receivables enable row level security;
create policy "fin_receivables: own" on fin_receivables using (user_id = auth.uid()::text);

alter table fin_email_sync_logs enable row level security;
create policy "fin_email_sync_logs: own sources" on fin_email_sync_logs using (
  source_id in (select id from fin_email_sources where user_id = auth.uid()::text)
);

create trigger trg_fin_loans_updated_at before update on fin_loans
for each row execute function update_updated_at();

create trigger trg_fin_receivables_updated_at before update on fin_receivables
for each row execute function update_updated_at();

-- Additional system categories requested
insert into fin_categories (id, name, icon, color, is_system, user_id)
values
  ('system-tecnologia', 'Tecnología', '💻', '#2563EB', true, null),
  ('system-cuidado-personal', 'Cuidado personal', '🧴', '#EC4899', true, null)
on conflict (id) do nothing;

insert into fin_categories (id, name, icon, is_system, user_id, parent_id)
values
  ('system-farmacia', 'Farmacia', '💊', true, null, 'system-salud'),
  ('system-medico', 'Médico', '🏥', true, null, 'system-salud'),
  ('system-gym', 'Gimnasio', '🏋️', true, null, 'system-salud'),
  ('system-celular', 'Celular', '📱', true, null, 'system-hogar'),
  ('system-gadgets', 'Gadgets', '🖥️', true, null, 'system-tecnologia'),
  ('system-software', 'Software', '⚙️', true, null, 'system-tecnologia'),
  ('system-belleza', 'Belleza', '💅', true, null, 'system-cuidado-personal'),
  ('system-barberia', 'Barbería', '✂️', true, null, 'system-cuidado-personal'),
  ('system-bonos', 'Bonos', '🎁', true, null, 'system-ingresos')
on conflict (id) do nothing;
