import { Inject, Injectable } from '@nestjs/common';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import type { FinTxStatus } from './commands/ledger.commands';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';
import { resolveLedgerCurrencyForTarget } from './resolve-ledger-currency';

@Injectable()
export class ImportEmailTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(
    userId: string,
    data: {
      accountId?: string;
      cardId?: string;
      emailMessageId: string;
      amount: number;
      currency: string;
      merchant: string | null;
      description: string;
      transactionDate: Date;
      categoryId?: string | null;
      type?: 'DEBIT' | 'CREDIT';
      status: FinTxStatus;
      aiMetadata?: unknown;
    },
  ) {
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
}
