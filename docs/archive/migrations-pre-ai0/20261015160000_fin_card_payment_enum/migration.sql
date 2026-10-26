-- New enum value and enums for card payments and statements. Kept apart from
-- the data migration: Postgres cannot add an enum value and use it in the same
-- transaction.

ALTER TYPE "FinTransactionType" ADD VALUE IF NOT EXISTS 'CARD_PAYMENT';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fin_card_statement_status') THEN
    CREATE TYPE "fin_card_statement_status" AS ENUM (
      'OPEN', 'CLOSED', 'PARTIAL', 'MINIMUM_PAID', 'PAID', 'OVERDUE'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fin_amount_source') THEN
    CREATE TYPE "fin_amount_source" AS ENUM ('IMPORTED', 'ESTIMATED', 'MANUAL');
  END IF;
END $$;
