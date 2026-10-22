import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { MerchantsService } from '../../merchants/application/merchants.service';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type { CreateTransactionCommand } from './commands/ledger.commands';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';
import { resolveLedgerCurrencyForTarget } from './resolve-ledger-currency';

@Injectable()
export class CreateTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
    private readonly ownership: FinanceOwnershipService,
    private readonly merchants: MerchantsService,
  ) {}

  async execute(
    userId: string,
    command: CreateTransactionCommand,
    source: 'MANUAL' | 'AI' = 'MANUAL',
  ) {
    const baseCurrency = await this.baseCurrency.execute(userId);
    const originalCurrency = command.currency
      ? normalizeCurrencyCode(command.currency)
      : baseCurrency;

    if (command.categoryId) {
      const category = await this.ownership.assertCategoryVisible(
        userId,
        command.categoryId,
      );
      this.ownership.assertCategoryMatchesTransactionType(
        category,
        command.type,
      );
    }

    const ledgerCurrency = await resolveLedgerCurrencyForTarget(
      this.repo,
      userId,
      command.accountId,
      command.cardId,
      originalCurrency,
    );

    const resolved = command.merchant
      ? await this.merchants.resolveTyped(userId, command.merchant)
      : null;

    const amounts = await this.resolveAmounts.execute({
      amount: command.amount,
      currency: originalCurrency,
      ledgerCurrency,
      baseCurrency,
      transactionDate: new Date(command.transactionDate),
    });

    const created = await this.repo.createTransaction(
      userId,
      {
        ...command,
        currency: originalCurrency,
        merchantId: resolved?.id,
      },
      amounts,
      source,
    );

    if (!created) {
      throw new BadRequestException(
        'Provide a valid accountId or cardId (exactly one)',
      );
    }

    void this.outboxDispatcher.processBatch();
    return mapLedgerTransaction(created.transaction);
  }
}
