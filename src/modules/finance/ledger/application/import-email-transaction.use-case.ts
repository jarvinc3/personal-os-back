import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import {
  TRANSFER_STATUS,
  type FinTxStatus,
  type TransferStatus,
} from './commands/ledger.commands';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';
import { resolveLedgerCurrencyForTarget } from './resolve-ledger-currency';

function toTransferStatus(status: FinTxStatus): TransferStatus {
  if (
    status === TRANSFER_STATUS.PENDING ||
    status === TRANSFER_STATUS.CONFIRMED
  ) {
    return status;
  }
  return TRANSFER_STATUS.CANCELLED;
}

export type ImportEmailMovementInput = {
  accountId?: string;
  cardId?: string;
  emailMessageId: string;
  externalReference?: string | null;
  amount: number;
  currency: string;
  merchant: string | null;
  description: string;
  notes?: string | null;
  transactionDate: Date;
  categoryId?: string | null;
  type?: 'DEBIT' | 'CREDIT';
  transferGroupId?: string | null;
  status: FinTxStatus;
  aiMetadata?: unknown;
};

@Injectable()
export class ImportEmailTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(userId: string, data: ImportEmailMovementInput) {
    const ledgerCurrency = await resolveLedgerCurrencyForTarget(
      this.repo,
      userId,
      data.accountId,
      data.cardId,
      data.currency,
    );
    const amounts = await this.resolveAmounts.execute({
      amount: data.amount,
      currency: data.currency,
      ledgerCurrency,
      transactionDate: data.transactionDate,
    });

    const created = await this.repo.createEmailImportTransaction(userId, {
      ...data,
      amounts,
    });
    void this.outboxDispatcher.processBatch();
    return created;
  }

  executeUnpairedTransfer(userId: string, data: ImportEmailMovementInput) {
    return this.execute(userId, {
      ...data,
      categoryId: null,
      transferGroupId: data.transferGroupId ?? randomUUID(),
    });
  }

  async executeAtmWithdrawal(
    userId: string,
    data: ImportEmailMovementInput & { cashAccountId: string },
  ) {
    const fromLedgerCurrency = await resolveLedgerCurrencyForTarget(
      this.repo,
      userId,
      data.accountId,
      data.cardId,
      data.currency,
    );
    const toLedgerCurrency = await resolveLedgerCurrencyForTarget(
      this.repo,
      userId,
      data.cashAccountId,
      undefined,
      data.currency,
    );
    const fromAmounts = await this.resolveAmounts.execute({
      amount: data.amount,
      currency: data.currency,
      ledgerCurrency: fromLedgerCurrency,
      transactionDate: data.transactionDate,
    });
    const toAmounts = await this.resolveAmounts.execute({
      amount: data.amount,
      currency: data.currency,
      ledgerCurrency: toLedgerCurrency,
      transactionDate: data.transactionDate,
    });
    const created = await this.repo.createTransfer(
      userId,
      {
        fromAccountId: data.accountId,
        fromCardId: data.cardId,
        toAccountId: data.cashAccountId,
        amount: data.amount,
        currency: data.currency,
        transactionDate: data.transactionDate.toISOString(),
        description: data.description,
        notes: data.notes ?? undefined,
        status: toTransferStatus(data.status),
        source: 'EMAIL',
        fromEmailMessageId: data.emailMessageId,
        aiMetadata: data.aiMetadata,
      },
      fromAmounts,
      toAmounts,
    );
    void this.outboxDispatcher.processBatch();
    return created;
  }

  async completeAtmFromExpense(
    userId: string,
    existingId: string,
    cashAccountId: string,
    data: {
      amount: number;
      currency: string;
      transactionDate: Date;
      description?: string | null;
      notes?: string | null;
      status: FinTxStatus;
    },
  ) {
    const ledgerCurrency = await resolveLedgerCurrencyForTarget(
      this.repo,
      userId,
      cashAccountId,
      undefined,
      data.currency,
    );
    const amounts = await this.resolveAmounts.execute({
      amount: data.amount,
      currency: data.currency,
      ledgerCurrency,
      transactionDate: data.transactionDate,
    });
    const created = await this.repo.addEmailTransferCounterpart(
      userId,
      existingId,
      {
        accountId: cashAccountId,
        amounts,
        description: data.description,
        notes: data.notes,
        status: data.status,
      },
    );
    void this.outboxDispatcher.processBatch();
    return created;
  }

  async pairTransferLegs(userId: string, debitId: string, creditId: string) {
    const created = await this.repo.pairEmailTransferLegs(
      userId,
      debitId,
      creditId,
    );
    void this.outboxDispatcher.processBatch();
    return created;
  }
}
