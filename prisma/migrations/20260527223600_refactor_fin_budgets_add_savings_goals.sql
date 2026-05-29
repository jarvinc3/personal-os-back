-- Finance migration 2: flexible budgets + savings goals

create type "FinBudgetPeriodType" as enum ('MONTHLY', 'BIWEEKLY', 'CUSTOM');

alter table fin_budgets add column period_type "FinBudgetPeriodType" not null default 'MONTHLY';
alter table fin_budgets add column period_start date not null default current_date;
alter table fin_budgets add column period_end date not null default current_date;

alter table fin_budgets drop constraint fin_budgets_user_category_year_month_key;
alter table fin_budgets drop column year;
alter table fin_budgets drop column month;
alter table fin_budgets
  add constraint fin_budgets_user_category_period_key unique (user_id, category_id, period_start, period_end);

create index fin_budgets_user_period_idx on fin_budgets(user_id, period_type, period_start);

create table fin_savings_goals (
  id text primary key default uuid_generate_v4()::text,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  description text,
  target_amount decimal(15,2) not null,
  current_amount decimal(15,2) not null default 0,
  currency char(3) not null default 'DOP',
  target_date date,
  icon text,
  color text,
  is_completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fin_savings_goals_user_id_completed_idx on fin_savings_goals(user_id, is_completed);

alter table fin_savings_goals enable row level security;
create policy "fin_savings_goals: own" on fin_savings_goals using (user_id = auth.uid()::text);

create trigger trg_fin_savings_goals_updated_at before update on fin_savings_goals
for each row execute function update_updated_at();
