import {
    BadRequestException,
    Inject,
    Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../../config';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
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
    private readonly config: ConfigService<Env, true>,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(
    userId: string,
    command: CreateTransactionCommand,
    source: 'MANUAL' | 'AI' = 'MANUAL',
  ) {
    const baseCurrency = this.config.get('BASE_CURRENCY', { infer: true });
    const originalCurrency = command.currency
      ? normalizeCurrencyCode(command.currency)
      : baseCurrency;

    const ledgerCurrency = await resolveLedgerCurrencyForTarget(
      this.repo,
      userId,
      command.accountId,
      command.cardId,
      originalCurrency,
    );

    const amounts = await this.resolveAmounts.execute({
      amount: command.amount,
      currency: originalCurrency,
      ledgerCurrency,
      transactionDate: new Date(command.transactionDate),
    });

    const created = await this.repo.createTransaction(
      userId,
      { ...command, currency: originalCurrency },
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
