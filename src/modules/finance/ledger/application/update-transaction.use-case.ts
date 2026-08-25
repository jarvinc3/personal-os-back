import {
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import { decimalToString } from '../../shared/domain/mappers';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type {
    TransactionUpdateFields,
    UpdateTransactionCommand,
} from './commands/ledger.commands';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';
import { resolveLedgerCurrencyForTarget } from './resolve-ledger-currency';

@Injectable()
export class UpdateTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(
    userId: string,
    id: string,
    command: UpdateTransactionCommand,
  ) {
    const existing = await this.repo.findTransactionById(id, userId);
    if (!existing) throw new NotFoundException('Transaction not found');

    const data: TransactionUpdateFields = {};

    if (command.type !== undefined) data.type = command.type;
    if (command.accountId !== undefined) data.accountId = command.accountId;
    if (command.cardId !== undefined) data.cardId = command.cardId;
    if (command.merchant !== undefined) data.merchant = command.merchant;
    if (command.description !== undefined) {
      data.description = command.description;
    }
    if (command.notes !== undefined) data.notes = command.notes;
    if (command.transactionDate !== undefined) {
      data.transactionDate = new Date(command.transactionDate);
    }
    if (command.categoryId !== undefined) data.categoryId = command.categoryId;
    if (command.status !== undefined) data.status = command.status;

    const needsFx =
      command.amount !== undefined ||
      command.currency !== undefined ||
      command.transactionDate !== undefined ||
      command.accountId !== undefined ||
      command.cardId !== undefined;

    if (needsFx) {
      const currency = command.currency
        ? normalizeCurrencyCode(command.currency)
        : existing.currency;
      const amount =
        command.amount !== undefined
          ? command.amount
          : Number(decimalToString(existing.amount));
      const accountId =
        command.accountId !== undefined
          ? (command.accountId ?? undefined)
          : (existing.accountId ?? undefined);
      const cardId =
        command.cardId !== undefined
          ? (command.cardId ?? undefined)
          : (existing.cardId ?? undefined);
      const transactionDate =
        command.transactionDate !== undefined
          ? new Date(command.transactionDate)
          : existing.transactionDate;

      const ledgerCurrency = await resolveLedgerCurrencyForTarget(
        this.repo,
        userId,
        accountId,
        cardId,
        currency,
      );
      const amounts = await this.resolveAmounts.execute({
        amount,
        currency,
        ledgerCurrency,
        transactionDate,
      });
      data.amount = amounts.amount;
      data.currency = amounts.currency;
      data.ledgerAmount = amounts.ledgerAmount;
      data.ledgerCurrency = amounts.ledgerCurrency;
      data.amountBaseCurrency = amounts.amountBaseCurrency;
      data.exchangeRate = amounts.exchangeRate;
    }

    const updated = await this.repo.updateTransaction(userId, id, data);
    if (!updated) throw new NotFoundException('Transaction not found');
    void this.outboxDispatcher.processBatch();
    return mapLedgerTransaction(updated.transaction);
  }
}
