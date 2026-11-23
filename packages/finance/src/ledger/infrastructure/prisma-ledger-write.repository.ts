import type { DomainEventPublisher } from '@personal-os/contracts';
import { DOMAIN_EVENT_PUBLISHER } from '@personal-os/contracts';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import type { BudgetThresholdPort } from '../../shared/application/budget-threshold.port';
import type { SubscriptionMatcherPort } from '../../shared/application/subscription-matcher.port';
import {
  BUDGET_THRESHOLD_PORT,
  SUBSCRIPTION_MATCHER,
} from '../../shared/application/tokens';
import type { ResolvedAmounts } from '../../shared/domain/money';
import type {
  CreateCardPaymentCommand,
  CreateTransferCommand,
  TransactionUpdateFields,
} from '../application/commands/ledger.commands';
import type {
  CreateTransactionResult,
  CreateTransferResult,
  ImportedCardPaymentOutcome,
  ManualCardPaymentOutcome,
} from '../application/ports/ledger.repository.port';
import type { IncomingCardPayment } from '../application/reconcile-card-payment-import';
import { CardPaymentOperations } from './card-payment-operations';
import { PrismaLedgerCardPaymentWriter } from './prisma-ledger-card-payment-writer';
import {
  PrismaLedgerMovementWriter,
  type CreateTransactionInput,
} from './prisma-ledger-movement-writer';
import { PrismaLedgerTransactionUpdater } from './prisma-ledger-transaction-updater';
import { TransferFeeLeg } from './prisma-ledger-transfer-fee';
import { PrismaLedgerTransferWriter } from './prisma-ledger-transfer-writer';

/**
 * Writes that create or edit movements. Cada operación vive en su pieza: alta y
 * reajuste, transferencia con su comisión, pago de tarjeta y ediciones.
 */
@Injectable()
export class PrismaLedgerWriteRepository {
  private readonly movements: PrismaLedgerMovementWriter;
  private readonly transfers: PrismaLedgerTransferWriter;
  private readonly cardPayments: PrismaLedgerCardPaymentWriter;
  private readonly cardPaymentOperations: CardPaymentOperations;
  private readonly updater: PrismaLedgerTransactionUpdater;
  private readonly feeLeg = new TransferFeeLeg();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    events: DomainEventPublisher,
    @Optional()
    @Inject(BUDGET_THRESHOLD_PORT)
    thresholds?: BudgetThresholdPort,
    @Optional()
    @Inject(SUBSCRIPTION_MATCHER)
    subscriptionMatcher?: SubscriptionMatcherPort,
  ) {
    this.movements = new PrismaLedgerMovementWriter({
      prisma,
      events,
      thresholds,
      subscriptionMatcher,
    });
    this.transfers = new PrismaLedgerTransferWriter({
      prisma,
      events,
      thresholds,
      feeLeg: this.feeLeg,
    });
    this.cardPaymentOperations = new CardPaymentOperations(prisma);
    this.cardPayments = new PrismaLedgerCardPaymentWriter({
      prisma,
      events,
      operations: this.cardPaymentOperations,
    });
    this.updater = new PrismaLedgerTransactionUpdater({
      prisma,
      events,
      thresholds,
      feeLeg: this.feeLeg,
    });
  }

  createTransaction(
    input: CreateTransactionInput,
  ): Promise<CreateTransactionResult | null> {
    return this.movements.createTransaction(input);
  }

  createBalanceAdjustment(
    userId: string,
    input: {
      accountId?: string | null;
      cardId?: string | null;
      amounts: ResolvedAmounts;
      description?: string;
      transactionDate?: Date;
    },
  ): Promise<CreateTransactionResult | null> {
    return this.movements.createBalanceAdjustment(userId, input);
  }

  createTransfer(input: {
    userId: string;
    command: CreateTransferCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    feeAmounts?: ResolvedAmounts;
    estimated: boolean;
  }): Promise<CreateTransferResult | null> {
    return this.transfers.createTransfer(input);
  }

  createCardPayment(input: {
    userId: string;
    command: CreateCardPaymentCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
  }): Promise<ManualCardPaymentOutcome> {
    return this.cardPayments.createCardPayment(input);
  }

  createImportedCardPayment(input: {
    userId: string;
    command: CreateCardPaymentCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    incoming: IncomingCardPayment;
  }): Promise<ImportedCardPaymentOutcome> {
    return this.cardPayments.createImportedCardPayment(input);
  }

  previewImportedCardPayment(input: {
    userId: string;
    incoming: IncomingCardPayment;
  }) {
    return this.cardPayments.previewImportedCardPayment(input);
  }

  findCardForPayment(userId: string, cardId: string) {
    return this.cardPaymentOperations.findCardForPayment(userId, cardId);
  }

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
    feeAmounts?: ResolvedAmounts;
    feeCategoryId?: string | null;
  }) {
    return this.updater.updateTransfer(input);
  }

  updateTransaction(
    userId: string,
    id: string,
    fields: TransactionUpdateFields,
  ): Promise<CreateTransactionResult | null> {
    return this.updater.updateTransaction(userId, id, fields);
  }
}
