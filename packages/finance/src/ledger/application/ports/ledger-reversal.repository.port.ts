import type { CreateTransactionResult } from './ledger.repository.port';

/** Revertir un movimiento o todas las patas de una operación. */
export interface LedgerReversalRepositoryPort {
  reverseTransaction(
    userId: string,
    originalId: string,
    aiMetadata?: unknown,
  ): Promise<CreateTransactionResult | null>;

  /** Reverts every CONFIRMED leg of an operation and marks it REVERSED. */
  reverseTransactionsByTransferGroupId(
    userId: string,
    transferGroupId: string,
  ): Promise<void>;
}
