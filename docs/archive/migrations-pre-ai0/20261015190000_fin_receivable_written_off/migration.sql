-- New receivable status. Kept apart from the data migration because Postgres
-- cannot add an enum value and use it in the same transaction.

ALTER TYPE "FinReceivableStatus" ADD VALUE IF NOT EXISTS 'WRITTEN_OFF';
