import { randomUUID } from 'crypto';
import type { DomainEventPublisher } from '@personal-os/contracts';
import type { Prisma, PrismaService } from '@personal-os/database';
import { FinanceEvents } from '../../contracts';
import type { BudgetThresholdPort } from '../../shared/application/budget-threshold.port';
import type { BudgetSpendSnapshot } from '../../shared/domain/budget-snapshot';
import { transactionCreatedEventName } from '../../shared/domain/mappers';
import type { ResolvedAmounts } from '../../shared/domain/money';
import { statusAffectsLedger } from '../../shared/domain/transaction-status';
import {
  OPERATION_LEG_ROLE,
  type OperationLegRole,
} from '../../shared/domain/transfer';
import {
  TRANSFER_STATUS,
  type CreateTransferCommand,
  type TransferStatus,
} from '../application/commands/ledger.commands';
import type {
  CreateTransferResult,
  LedgerTransactionRow,
} from '../application/ports/ledger.repository.port';
import {
  adjustBudgetSpent,
  applyBalanceForTransaction,
  resolveLedgerTarget,
  type LedgerTarget,
} from './balance.helpers';
import { enqueueTransactionEvent } from './ledger-transaction-events';
import type { TransferFeeLeg } from './prisma-ledger-transfer-fee';

type TransferWriterDeps = {
  prisma: PrismaService;
  events: DomainEventPublisher;
  thresholds?: BudgetThresholdPort;
  feeLeg: TransferFeeLeg;
};

type TransferLegContext = {
  tx: Prisma.TransactionClient;
  userId: string;
  command: CreateTransferCommand;
  transferGroupId: string;
  transactionDate: Date;
  source: 'MANUAL' | 'EMAIL' | 'AI';
  estimated: boolean;
  budgetSnapshots: BudgetSpendSnapshot[];
};

type TransferLegInput = {
  type: 'DEBIT' | 'CREDIT';
  target: LedgerTarget;
  amounts: ResolvedAmounts;
  legRole: OperationLegRole;
  legStatus: TransferStatus;
  categoryId?: string | null;
  importReference?: string;
};

/** Writes the two legs of a transfer and its optional fee leg. */
export class PrismaLedgerTransferWriter {
  constructor(private readonly deps: TransferWriterDeps) {}

  createTransfer(input: {
    userId: string;
    command: CreateTransferCommand;
    fromAmounts: ResolvedAmounts;
    toAmounts: ResolvedAmounts;
    feeAmounts?: ResolvedAmounts;
    estimated: boolean;
  }): Promise<CreateTransferResult | null> {
    return this.deps.prisma.$transaction(async (tx) => {
      const targets = await resolveTransferTargets({
        tx,
        userId: input.userId,
        command: input.command,
      });
      if (!targets) {
        return null;
      }
      const { fromTarget, toTarget } = targets;
      const transferGroupId = randomUUID();
      const status = input.command.status ?? 'CONFIRMED';
      const context: TransferLegContext = {
        tx,
        userId: input.userId,
        command: input.command,
        transferGroupId,
        transactionDate: new Date(input.command.transactionDate),
        source: input.command.source ?? 'MANUAL',
        estimated: input.estimated,
        budgetSnapshots: [],
      };

      const debit = await this.createLeg(context, {
        type: 'DEBIT',
        target: fromTarget,
        amounts: input.fromAmounts,
        legRole: OPERATION_LEG_ROLE.SOURCE,
        legStatus: status,
        importReference: input.command.fromImportReference,
      });
      const credit = await this.createLeg(context, {
        type: 'CREDIT',
        target: toTarget,
        amounts: input.toAmounts,
        legRole: OPERATION_LEG_ROLE.DESTINATION,
        legStatus: input.command.destinationPending
          ? TRANSFER_STATUS.PENDING
          : status,
        importReference: input.command.toImportReference,
      });

      const fee =
        input.command.fee && input.feeAmounts
          ? await this.createLeg(context, {
              type: 'DEBIT',
              target: fromTarget,
              amounts: input.feeAmounts,
              legRole: OPERATION_LEG_ROLE.FEE,
              legStatus: status,
              categoryId:
                input.command.fee.categoryId ??
                (await this.deps.feeLeg.resolveCategoryId(tx)),
            })
          : undefined;

      await this.deps.events.enqueue(
        {
          eventName: FinanceEvents.TRANSFER_CREATED,
          aggregateType: 'FinTransfer',
          aggregateId: transferGroupId,
          userId: input.userId,
          payload: {
            transferGroupId,
            debitId: debit.id,
            creditId: credit.id,
            ...(fee ? { feeId: fee.id } : {}),
            amount: Number(debit.amount),
          },
        },
        tx,
      );

      await this.deps.thresholds?.processThresholds(
        input.userId,
        context.budgetSnapshots,
        tx,
      );

      return { debit, credit, ...(fee ? { fee } : {}), transferGroupId };
    });
  }

  private async createLeg(
    context: TransferLegContext,
    leg: TransferLegInput,
  ): Promise<LedgerTransactionRow> {
    const { command, tx } = context;
    const created = await tx.finTransaction.create({
      data: {
        userId: context.userId,
        accountId: leg.target.accountId,
        cardId: leg.target.cardId,
        type: leg.type,
        amount: leg.amounts.amount,
        ledgerAmount: leg.amounts.ledgerAmount,
        amountBaseCurrency: leg.amounts.amountBaseCurrency,
        currency: leg.amounts.currency,
        ledgerCurrency: leg.amounts.ledgerCurrency,
        exchangeRate: leg.amounts.exchangeRate,
        isEstimated: context.estimated,
        categoryId: leg.categoryId ?? null,
        description: command.description,
        notes: command.notes,
        source: context.source,
        status: leg.legStatus,
        legRole: leg.legRole,
        rail: command.rail ?? null,
        transferGroupId: context.transferGroupId,
        transactionDate: context.transactionDate,
        ...(leg.importReference
          ? { importReference: leg.importReference }
          : {}),
        ...(command.aiMetadata ? { aiMetadata: command.aiMetadata } : {}),
      },
      include: {
        account: { select: { id: true, name: true } },
        card: { select: { id: true, name: true } },
      },
    });

    if (statusAffectsLedger(leg.legStatus)) {
      await applyBalanceForTransaction(tx, {
        accountId: leg.target.accountId,
        cardId: leg.target.cardId,
        cardType: leg.target.cardType,
        derivedAccountId: leg.target.derivedAccountId,
        currency: leg.amounts.ledgerCurrency,
        type: leg.type,
        amount: leg.amounts.ledgerAmount,
      });
      const snapshots = await adjustBudgetSpent(tx, {
        userId: context.userId,
        categoryId: leg.categoryId ?? null,
        type: leg.type,
        amountBaseCurrency: leg.amounts.amountBaseCurrency,
        transactionDate: context.transactionDate,
      });
      context.budgetSnapshots.push(...snapshots);
    }

    await enqueueTransactionEvent({
      tx,
      events: this.deps.events,
      userId: context.userId,
      eventName: transactionCreatedEventName(created.status),
      transactionId: created.id,
      announce: command.announce,
    });
    return created;
  }
}

/** Los dos productos se resuelven y son distintos; si no, no hay transferencia. */
async function resolveTransferTargets({
  tx,
  userId,
  command,
}: {
  tx: Prisma.TransactionClient;
  userId: string;
  command: CreateTransferCommand;
}): Promise<{ fromTarget: LedgerTarget; toTarget: LedgerTarget } | null> {
  const fromTarget = await resolveLedgerTarget(
    tx,
    userId,
    command.fromAccountId,
    command.fromCardId,
  );
  const toTarget = await resolveLedgerTarget(
    tx,
    userId,
    command.toAccountId,
    undefined,
  );
  if (!fromTarget || !toTarget) {
    return null;
  }
  const fromKey = `${fromTarget.accountId ?? ''}:${fromTarget.cardId ?? ''}`;
  const toKey = `${toTarget.accountId ?? ''}:${toTarget.cardId ?? ''}`;
  if (fromKey === toKey) {
    return null;
  }
  return { fromTarget, toTarget };
}
