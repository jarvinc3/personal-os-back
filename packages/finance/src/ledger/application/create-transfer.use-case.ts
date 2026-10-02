import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type { CreateTransferCommand } from './commands/ledger.commands';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';
import { resolveLedgerCurrencyForTarget } from './resolve-ledger-currency';

@Injectable()
export class CreateTransferUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly config: ConfigService<Env, true>,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(userId: string, command: CreateTransferCommand) {
    const baseCurrency = this.config.get('BASE_CURRENCY', { infer: true });
    const currency = command.currency
      ? normalizeCurrencyCode(command.currency)
      : baseCurrency;

    const fromLedgerCurrency = await resolveLedgerCurrencyForTarget(
      this.repo,
      userId,
      command.fromAccountId,
      command.fromCardId,
      currency,
    );
    const toLedgerCurrency = await resolveLedgerCurrencyForTarget(
      this.repo,
      userId,
      command.toAccountId,
      command.toCardId,
      currency,
    );

    const fromAmounts = await this.resolveAmounts.execute({
      amount: command.amount,
      currency,
      ledgerCurrency: fromLedgerCurrency,
      transactionDate: new Date(command.transactionDate),
    });
    const toAmounts = await this.resolveAmounts.execute({
      amount: command.amount,
      currency,
      ledgerCurrency: toLedgerCurrency,
      transactionDate: new Date(command.transactionDate),
    });

    const created = await this.repo.createTransfer(
      userId,
      command,
      fromAmounts,
      toAmounts,
    );
    if (!created) {
      throw new NotFoundException('Invalid transfer accounts');
    }

    void this.outboxDispatcher.processBatch();
    return {
      transferGroupId: created.transferGroupId,
      debit: mapLedgerTransaction(created.debit),
      credit: mapLedgerTransaction(created.credit),
    };
  }
}
