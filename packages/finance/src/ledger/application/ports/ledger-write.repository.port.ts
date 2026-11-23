import type { ResolvedAmounts } from '../../../shared/domain/money';
import type {
  CreateCardPaymentCommand,
  CreateTransactionCommand,
  CreateTransferCommand,
  TransactionUpdateFields,
} from '../commands/ledger.commands';
import type {
  CardPaymentImportDecision,
  IncomingCardPayment,
} from '../reconcile-card-payment-import';
import type {
  CreateTransactionResult,
  CreateTransferResult,
  ImportedCardPaymentOutcome,
  LedgerTransactionRow,
  ManualCardPaymentOutcome,
} from './ledger.repository.port';

/** Altas y ediciones del ledger, con su efecto en saldo y presupuesto. */
export type CreateTransactionInput = {
  userId: string;
  command: CreateTransactionCommand;
  amounts: ResolvedAmounts;
  source?: 'MANUAL' | 'EMAIL' | 'AI';
  extras?: {
    importReference?: string;
    aiMetadata?: unknown;
    linkedTransactionId?: string;
    transferGroupId?: string;
  };
};

export interface LedgerWriteRepositoryPort {
  clearPossibleDuplicate(userId: string, id: string): Promise<void>;

  createBalanceAdjustment(
    userId: string,
    input: {
      accountId?: string | null;
      cardId?: string | null;
      amounts: ResolvedAmounts;
      description?: string;
      transactionDate?: Date;
    },
  ): Promise<CreateTransactionResult | null>;

  createTransaction(
    input: CreateTransactionInput,
  ): Promise<CreateTransactionResult | null>;

  createTransfer(input: {
    userId: string;
    command: CreateTransferCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    feeAmounts?: ResolvedAmounts;
    estimated: boolean;
  }): Promise<CreateTransferResult | null>;

  /**
   * Un pago de tarjeta son dos patas `CARD_PAYMENT`. Decide y escribe en la
   * misma transacción: parecido a un pago importado y sin
   * `duplicateAcknowledged`, no escribe y devuelve el candidato.
   */
  createCardPayment(input: {
    userId: string;
    command: CreateCardPaymentCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
  }): Promise<ManualCardPaymentOutcome>;

  /**
   * Igual que `createCardPayment`, pero decide dentro de la misma transacción
   * con un bloqueo por usuario: dos correos simultáneos con la misma operación
   * no pueden crear dos pagos.
   */
  createImportedCardPayment(input: {
    userId: string;
    command: CreateCardPaymentCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    incoming: IncomingCardPayment;
  }): Promise<ImportedCardPaymentOutcome>;

  previewImportedCardPayment(input: {
    userId: string;
    incoming: IncomingCardPayment;
  }): Promise<CardPaymentImportDecision>;

  findCardForPayment(
    userId: string,
    cardId: string,
  ): Promise<{ id: string; type: string; currencies: string[] } | null>;

  /** Replaces both legs (and the fee effect) inside one transaction. */
  updateTransfer(input: {
    userId: string;
    debitId: string;
    creditId: string;
    debitTarget: { accountId: string | null; cardId: string | null };
    creditTarget: { accountId: string | null; cardId: string | null };
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    estimated: boolean;
    transactionDate: Date;
    description?: string | null;
    notes?: string | null;
    /** When present, updates the FEE leg (creating it if the transfer had none). */
    feeAmounts?: ResolvedAmounts;
    feeCategoryId?: string | null;
  }): Promise<{
    debit: LedgerTransactionRow;
    credit: LedgerTransactionRow;
  } | null>;

  updateTransaction(
    userId: string,
    id: string,
    data: TransactionUpdateFields,
  ): Promise<CreateTransactionResult | null>;
}
