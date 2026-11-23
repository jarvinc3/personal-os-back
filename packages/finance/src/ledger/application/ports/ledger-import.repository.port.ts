import type { ImportFinancialTransactionCommand } from '../commands/ledger.commands';
import type {
  CreateTransferResult,
  ImportedTransferCounterpart,
  LedgerTransactionRow,
} from './ledger.repository.port';

/** Importación por correo: filas con referencia, patas y contrapartes. */
export interface LedgerImportRepositoryPort {
  createImportedTransaction(
    userId: string,
    data: ImportFinancialTransactionCommand,
  ): Promise<LedgerTransactionRow>;

  pairImportedTransferLegs(
    userId: string,
    debitId: string,
    creditId: string,
  ): Promise<CreateTransferResult | null>;

  addImportedTransferCounterpart(
    userId: string,
    existingId: string,
    counterpart: ImportedTransferCounterpart,
  ): Promise<CreateTransferResult | null>;
}
