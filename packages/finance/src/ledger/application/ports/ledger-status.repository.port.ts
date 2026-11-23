import type { BudgetSpendSnapshot } from '../../../shared/domain/budget-snapshot';
import type { CreateTransactionResult } from './ledger.repository.port';

/** Confirmar y desconfirmar movimientos, uno o toda la operación. */
export interface LedgerStatusRepositoryPort {
  confirmTransaction(
    userId: string,
    id: string,
  ): Promise<CreateTransactionResult | null>;

  /** Reverts balance and budget effect and moves a CONFIRMED movement to PENDING. */
  unconfirmTransaction(
    userId: string,
    id: string,
  ): Promise<CreateTransactionResult | null>;

  confirmTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ): Promise<{ count: number; budgetSnapshots: BudgetSpendSnapshot[] }>;

  unconfirmTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ): Promise<{ count: number }>;
}
