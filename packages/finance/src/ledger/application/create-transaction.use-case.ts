import type { DomainEventRelay } from '@personal-os/contracts';
import { DOMAIN_EVENT_RELAY } from '@personal-os/contracts';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { MerchantsService } from '../../merchants/application/merchants.service';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import {
  LEDGER_QUERY_REPOSITORY,
  LEDGER_WRITE_REPOSITORY,
} from '../../shared/application/tokens';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type { CreateTransactionCommand } from './commands/ledger.commands';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerQueryRepositoryPort } from './ports/ledger-query.repository.port';
import type { LedgerWriteRepositoryPort } from './ports/ledger-write.repository.port';
import { resolveLedgerCurrencyForTarget } from './resolve-ledger-currency';

@Injectable()
export class CreateTransactionUseCase {
  constructor(
    @Inject(LEDGER_WRITE_REPOSITORY)
    private readonly repo: LedgerWriteRepositoryPort,
    @Inject(LEDGER_QUERY_REPOSITORY)
    private readonly query: LedgerQueryRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
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
      this.query,
      userId,
      command.accountId,
      command.cardId,
      originalCurrency,
    );

    const resolved = command.merchant
      ? await this.merchants.resolveTyped({
          userId,
          rawName: command.merchant,
          categoryId: command.categoryId,
          transactionType: command.type,
        })
      : null;

    const amounts = await this.resolveAmounts.execute({
      amount: command.amount,
      currency: originalCurrency,
      ledgerCurrency,
      baseCurrency,
      transactionDate: new Date(command.transactionDate),
    });

    const created = await this.repo.createTransaction({
      userId,
      command: {
        ...command,
        currency: originalCurrency,
        merchantId: resolved?.id,
      },
      amounts,
      source,
    });

    if (!created) {
      throw new BadRequestException(
        'Provide a valid accountId or cardId (exactly one)',
      );
    }

    void this.relay.wake();
    return mapLedgerTransaction(created.transaction);
  }
}
