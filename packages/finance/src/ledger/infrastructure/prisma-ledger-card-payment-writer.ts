import { randomUUID } from 'crypto';
import type { DomainEventPublisher } from '@personal-os/contracts';
import type { Prisma, PrismaService } from '@personal-os/database';
import { FinanceEvents } from '../../contracts';
import { transactionCreatedEventName } from '../../shared/domain/mappers';
import type { ResolvedAmounts } from '../../shared/domain/money';
import { statusAffectsLedger } from '../../shared/domain/transaction-status';
import {
  OPERATION_LEG_ROLE,
  type OperationLegRole,
} from '../../shared/domain/transfer';
import type {
  CreateCardPaymentCommand,
  TransferStatus,
} from '../application/commands/ledger.commands';
import { findManualCardPaymentDuplicate } from '../application/find-manual-card-payment-duplicate';
import type {
  ImportedCardPaymentOutcome,
  ManualCardPaymentOutcome,
} from '../application/ports/ledger.repository.port';
import type {
  CreateTransferResult,
  LedgerTransactionRow,
} from '../application/ports/ledger.repository.port';
import {
  reconcileCardPaymentImport,
  type CardPaymentImportDecision,
  type IncomingCardPayment,
} from '../application/reconcile-card-payment-import';
import {
  applyBalanceForTransaction,
  resolveLedgerTarget,
  type LedgerTarget,
} from './balance.helpers';
import type { CardPaymentOperations } from './card-payment-operations';
import { enqueueTransactionEvent } from './ledger-transaction-events';

type CardPaymentWriterDeps = {
  prisma: PrismaService;
  events: DomainEventPublisher;
  operations: CardPaymentOperations;
};

type CardPaymentInput = {
  userId: string;
  command: CreateCardPaymentCommand;
  fromAmounts: ResolvedAmounts;
  toAmounts: ResolvedAmounts;
};

/** Pago de tarjeta de dos patas: cuenta de origen contra la tarjeta. */
export class PrismaLedgerCardPaymentWriter {
  constructor(private readonly deps: CardPaymentWriterDeps) {}

  async createCardPayment(
    input: CardPaymentInput,
  ): Promise<ManualCardPaymentOutcome> {
    const { userId, command, fromAmounts } = input;
    return this.deps.prisma.$transaction(async (tx) => {
      await this.deps.operations.lock(userId, tx);
      if (!command.duplicateAcknowledged) {
        const transactionDate = new Date(command.transactionDate);
        const duplicate = findManualCardPaymentDuplicate({
          incoming: {
            accountId: command.fromAccountId,
            cardId: command.cardId,
            amount: command.amount,
            currency: fromAmounts.currency,
            transactionDate,
            bankReference: command.externalReference ?? null,
          },
          existing: await this.deps.operations.loadOperations(
            tx,
            userId,
            transactionDate,
          ),
        });
        if (duplicate.kind === 'possible_duplicate') {
          return duplicate;
        }
      }
      const created = await this.writeCardPayment(tx, input);
      if (!created) {
        return { kind: 'not_written' };
      }
      return { kind: 'created', payment: created };
    });
  }

  /**
   * Decide y escribe dentro de una sola transacción, con un bloqueo por usuario.
   * Dos correos simultáneos con la misma operación no pueden crear dos pagos:
   * el segundo ve el pago del primero y se vincula.
   */
  async createImportedCardPayment(
    input: CardPaymentInput & { incoming: IncomingCardPayment },
  ): Promise<ImportedCardPaymentOutcome> {
    const { userId, incoming } = input;
    return this.deps.prisma.$transaction(async (tx) => {
      await this.deps.operations.lock(userId, tx);
      const decision = reconcileCardPaymentImport({
        incoming,
        existing: await this.deps.operations.loadOperations(
          tx,
          userId,
          incoming.transactionDate,
        ),
      });
      if (decision.kind === 'duplicate') {
        return {
          kind: 'duplicate',
          transferGroupId: decision.transferGroupId,
          sourceTransactionId: decision.transactionId,
        };
      }
      if (decision.kind === 'conflict' || decision.kind === 'ambiguous') {
        return {
          kind: 'review',
          reason: decision.reason,
          candidateTransactionIds: decision.candidateTransactionIds,
        };
      }
      const created = await this.writeCardPayment(tx, input);
      if (!created) {
        return { kind: 'not_written' };
      }
      return {
        kind: 'created',
        transferGroupId: created.transferGroupId,
        sourceTransactionId: created.debit.id,
        cardTransactionId: created.credit.id,
      };
    });
  }

  async previewImportedCardPayment({
    userId,
    incoming,
  }: {
    userId: string;
    incoming: IncomingCardPayment;
  }): Promise<CardPaymentImportDecision> {
    return reconcileCardPaymentImport({
      incoming,
      existing: await this.deps.operations.loadOperations(
        this.deps.prisma,
        userId,
        incoming.transactionDate,
      ),
    });
  }

  private async writeCardPayment(
    tx: Prisma.TransactionClient,
    input: CardPaymentInput,
  ): Promise<CreateTransferResult | null> {
    const { userId, command } = input;
    const fromTarget = await resolveLedgerTarget(
      tx,
      userId,
      command.fromAccountId,
      undefined,
    );
    const toTarget = await resolveLedgerTarget(
      tx,
      userId,
      undefined,
      command.cardId,
    );
    if (!fromTarget || !toTarget) {
      return null;
    }

    const context = {
      tx,
      userId,
      command,
      fromAmounts: input.fromAmounts,
      toAmounts: input.toAmounts,
      transferGroupId: randomUUID(),
      status: command.status ?? 'CONFIRMED',
      transactionDate: new Date(command.transactionDate),
      source: command.source ?? 'MANUAL',
    };
    const debit = await this.createLeg(context, {
      target: fromTarget,
      amounts: input.fromAmounts,
      legRole: OPERATION_LEG_ROLE.SOURCE,
    });
    const credit = await this.createLeg(context, {
      target: toTarget,
      amounts: input.toAmounts,
      legRole: OPERATION_LEG_ROLE.DESTINATION,
    });

    await this.deps.events.enqueue(
      {
        eventName: FinanceEvents.TRANSFER_CREATED,
        aggregateType: 'FinTransfer',
        aggregateId: context.transferGroupId,
        userId,
        payload: {
          transferGroupId: context.transferGroupId,
          debitId: debit.id,
          creditId: credit.id,
          amount: Number(debit.amount),
        },
      },
      tx,
    );

    return { debit, credit, transferGroupId: context.transferGroupId };
  }

  private async createLeg(
    context: {
      tx: Prisma.TransactionClient;
      userId: string;
      command: CreateCardPaymentCommand;
      transferGroupId: string;
      status: TransferStatus;
      transactionDate: Date;
      source: 'MANUAL' | 'EMAIL' | 'AI';
    },
    leg: {
      target: LedgerTarget;
      amounts: ResolvedAmounts;
      legRole: OperationLegRole;
    },
  ): Promise<LedgerTransactionRow> {
    const { command, tx } = context;
    const created = await tx.finTransaction.create({
      data: {
        userId: context.userId,
        accountId: leg.target.accountId,
        cardId: leg.target.cardId,
        type: 'CARD_PAYMENT',
        amount: leg.amounts.amount,
        ledgerAmount: leg.amounts.ledgerAmount,
        amountBaseCurrency: leg.amounts.amountBaseCurrency,
        currency: leg.amounts.currency,
        ledgerCurrency: leg.amounts.ledgerCurrency,
        exchangeRate: leg.amounts.exchangeRate,
        description: command.description,
        notes: command.notes,
        source: context.source,
        status: context.status,
        legRole: leg.legRole,
        transferGroupId: context.transferGroupId,
        externalReference: command.externalReference ?? null,
        importReference:
          leg.legRole === OPERATION_LEG_ROLE.SOURCE
            ? (command.importReference ?? null)
            : null,
        ...(command.aiMetadata ? { aiMetadata: command.aiMetadata } : {}),
        transactionDate: context.transactionDate,
      },
      include: {
        account: { select: { id: true, name: true } },
        card: { select: { id: true, name: true } },
      },
    });

    if (statusAffectsLedger(context.status)) {
      await applyBalanceForTransaction(tx, {
        accountId: leg.target.accountId,
        cardId: leg.target.cardId,
        cardType: leg.target.cardType,
        derivedAccountId: leg.target.derivedAccountId,
        currency: leg.amounts.ledgerCurrency,
        type: 'CARD_PAYMENT',
        amount: leg.amounts.ledgerAmount,
      });
    }

    await enqueueTransactionEvent({
      tx,
      events: this.deps.events,
      userId: context.userId,
      eventName: transactionCreatedEventName(created.status),
      transactionId: created.id,
    });
    return created;
  }
}
