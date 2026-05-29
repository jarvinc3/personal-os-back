-- Finance migration 1: institutions + cards + multi-currency balances

create type "FinCardType" as enum ('CREDIT', 'DEBIT');
create type "FinCardNetwork" as enum ('VISA', 'MASTERCARD', 'AMEX', 'DISCOVER', 'OTHER');
create type "FinTransactionSource" as enum ('MANUAL', 'EMAIL', 'AI');

alter type "FinAccountType" rename to "FinAccountType_old";
create type "FinAccountType" as enum ('CHECKING', 'SAVINGS', 'CASH', 'INVESTMENT');
alter table fin_accounts
  alter column type type "FinAccountType" using (type::text::"FinAccountType");
drop type "FinAccountType_old";

create table fin_institutions (
  id text primary key default uuid_generate_v4()::text,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  color text,
  logo_url text,
  country text not null default 'DO',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table fin_accounts add column institution_id text references fin_institutions(id);

create table fin_cards (
  id text primary key default uuid_generate_v4()::text,
  user_id text not null references users(id) on delete cascade,
  institution_id text not null references fin_institutions(id) on delete cascade,
  account_id text references fin_accounts(id),
  name text not null,
  last_four char(4),
  type "FinCardType" not null,
  network "FinCardNetwork",
  statement_closing_day integer,
  payment_due_day integer,
  color text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table fin_card_balances (
  id text primary key default uuid_generate_v4()::text,
  card_id text not null references fin_cards(id) on delete cascade,
  currency char(3) not null,
  balance decimal(15,2) not null default 0,
  credit_limit decimal(15,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fin_card_balances_card_id_currency_key unique(card_id, currency)
);

alter table fin_transactions add column card_id text references fin_cards(id) on delete cascade;
alter table fin_transactions alter column account_id drop not null;
alter table fin_transactions add column source "FinTransactionSource" not null default 'MANUAL';

create index fin_institutions_user_id_active_idx on fin_institutions(user_id, is_active);
create index fin_institutions_user_id_name_idx on fin_institutions(user_id, name);
create index fin_cards_user_id_institution_id_idx on fin_cards(user_id, institution_id);
create index fin_cards_user_id_active_idx on fin_cards(user_id, is_active);
create index fin_accounts_user_id_active_idx on fin_accounts(user_id, is_active);
create index fin_transactions_card_id_date_idx on fin_transactions(card_id, transaction_date);

alter table fin_institutions enable row level security;
create policy "fin_institutions: own" on fin_institutions using (user_id = auth.uid()::text);

alter table fin_cards enable row level security;
create policy "fin_cards: own" on fin_cards using (user_id = auth.uid()::text);

alter table fin_card_balances enable row level security;
create policy "fin_card_balances: own cards" on fin_card_balances using (
  card_id in (select id from fin_cards where user_id = auth.uid()::text)
);

create trigger trg_fin_institutions_updated_at before update on fin_institutions
for each row execute function update_updated_at();

create trigger trg_fin_cards_updated_at before update on fin_cards
for each row execute function update_updated_at();

create trigger trg_fin_card_balances_updated_at before update on fin_card_balances
for each row execute function update_updated_at();
