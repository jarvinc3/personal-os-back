import type { DomainEventRelay } from '@personal-os/contracts';
import { DOMAIN_EVENT_RELAY } from '@personal-os/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { withRateMetadata } from '../../fx/application/rate-metadata';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { MerchantsService } from '../../merchants/application/merchants.service';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import {
  OPERATION_LEG_ROLE,
  type OperationLegRole,
} from '../../shared/domain/transfer';
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

export type ImportFinancialMovementInput = {
  accountId?: string;
  cardId?: string;
  importReference: string;
  externalReference?: string | null;
  amount: number;
  currency: string;
  merchant: string | null;
  merchantId?: string | null;
  merchantIsPlaceholder?: boolean;
  description: string;
  notes?: string | null;
  transactionDate: Date;
  categoryId?: string | null;
  type?: 'DEBIT' | 'CREDIT';
  transferGroupId?: string | null;
  linkedTransactionId?: string | null;
  sourceEmailMessageId?: string | null;
  legRole?: OperationLegRole | null;
  status: FinTxStatus;
  aiMetadata?: unknown;
};

@Injectable()
export class ImportFinancialTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
    private readonly merchants: MerchantsService,
  ) {}

  async execute(userId: string, data: ImportFinancialMovementInput) {
    const ledgerCurrency = await resolveLedgerCurrencyForTarget(
      this.repo,
      userId,
      data.accountId,
      data.cardId,
      data.currency,
    );
    const baseCurrency = await this.baseCurrency.execute(userId);
    const amounts = await this.resolveAmounts.execute({
      amount: data.amount,
      currency: data.currency,
      ledgerCurrency,
      baseCurrency,
      transactionDate: data.transactionDate,
    });

    const resolvedMerchant =
      data.merchant && !data.merchantIsPlaceholder
        ? await this.merchants.resolve({
            userId,
            rawName: data.merchant,
            categoryId: data.categoryId,
            transactionType: data.type,
          })
        : null;

    const created = await this.repo.createImportedTransaction(userId, {
      ...data,
      aiMetadata: withRateMetadata({ aiMetadata: data.aiMetadata, amounts }),
      merchantId: resolvedMerchant?.id ?? null,
      amounts,
    });
    void this.relay.wake();
    return created;
  }

  executeUnpairedTransfer(userId: string, data: ImportFinancialMovementInput) {
    return this.execute(userId, {
      ...data,
      cardId: undefined,
      categoryId: null,
      transferGroupId: data.transferGroupId ?? randomUUID(),
      legRole:
        data.legRole ??
        (data.type === 'CREDIT'
          ? OPERATION_LEG_ROLE.DESTINATION
          : OPERATION_LEG_ROLE.SOURCE),
    });
  }

  async executeAtmWithdrawal(
    userId: string,
    data: ImportFinancialMovementInput & { cashAccountId: string },
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
    const baseCurrency = await this.baseCurrency.execute(userId);
    const fromAmounts = await this.resolveAmounts.execute({
      amount: data.amount,
      currency: data.currency,
      ledgerCurrency: fromLedgerCurrency,
      baseCurrency,
      transactionDate: data.transactionDate,
    });
    const { amounts: toAmounts, estimated } =
      await this.resolveAmounts.resolveTransferDestination({
        sourceAmount: data.amount,
        sourceCurrency: data.currency,
        destinationCurrency: toLedgerCurrency,
        baseCurrency,
        transactionDate: data.transactionDate,
      });
    const created = await this.repo.createTransfer({
      userId,
      command: {
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
        fromImportReference: data.importReference,
        aiMetadata: withRateMetadata({
          aiMetadata: withRateMetadata({
            aiMetadata: data.aiMetadata,
            amounts: fromAmounts,
          }),
          amounts: toAmounts,
          scope: 'destination',
        }),
      },
      fromAmounts,
      toAmounts,
      estimated,
    });
    void this.relay.wake();
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
    const baseCurrency = await this.baseCurrency.execute(userId);
    const amounts = await this.resolveAmounts.execute({
      amount: data.amount,
      currency: data.currency,
      ledgerCurrency,
      baseCurrency,
      transactionDate: data.transactionDate,
    });
    const created = await this.repo.addImportedTransferCounterpart(
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
    void this.relay.wake();
    return created;
  }

  async pairTransferLegs(userId: string, debitId: string, creditId: string) {
    const created = await this.repo.pairImportedTransferLegs(
      userId,
      debitId,
      creditId,
    );
    void this.relay.wake();
    return created;
  }
}
