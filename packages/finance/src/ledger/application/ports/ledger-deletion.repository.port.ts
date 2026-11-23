import type {
  RestoreResult,
  StoredMovement,
} from '../../../shared/domain/deletion-snapshot';
import type { LedgerTransactionRow } from './ledger.repository.port';

/** Borrado y restauración del ledger, y purga por instrumento. */
export interface LedgerDeletionRepositoryPort {
  deleteTransaction(userId: string, id: string): Promise<{ count: number }>;

  restoreTransaction(
    userId: string,
    id: string,
    now: Date,
  ): Promise<RestoreResult>;

  deleteTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ): Promise<{ count: number }>;

  purgeLedgerForAccount(
    userId: string,
    accountId: string,
  ): Promise<{ count: number; rows: LedgerTransactionRow[] }>;

  purgeLedgerForCard(
    userId: string,
    cardId: string,
  ): Promise<{ count: number; rows: LedgerTransactionRow[] }>;

  /** Puts the balance and budget effect of movements a delete reversed. */
  restoreLedgerTransactions(
    userId: string,
    movements: readonly StoredMovement[],
  ): Promise<{ count: number }>;
}
