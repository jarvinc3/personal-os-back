import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import {
  CARD_CURRENCY_MISSING,
  CARD_CURRENCY_MISSING_MESSAGE,
  CARD_NOT_CREDIT,
  CARD_NOT_CREDIT_MESSAGE,
  CARD_NOT_FOUND,
  CARD_NOT_FOUND_MESSAGE,
} from '../../shared/domain/card-payment';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type { CreateCardPaymentCommand } from './commands/ledger.commands';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';
import { requireOwnedAccount } from './resolve-ledger-currency';

@Injectable()
export class CreateCardPaymentUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(userId: string, command: CreateCardPaymentCommand) {
    const card = await this.repo.findCardForPayment(userId, command.cardId);
    if (!card) {
      throw new NotFoundException({
        code: CARD_NOT_FOUND,
        message: CARD_NOT_FOUND_MESSAGE,
      });
    }
    if (card.type !== 'CREDIT') {
      throw new BadRequestException({
        code: CARD_NOT_CREDIT,
        message: CARD_NOT_CREDIT_MESSAGE,
      });
    }

    const baseCurrency = await this.baseCurrency.execute(userId);
    const currency = command.currency
      ? normalizeCurrencyCode(command.currency)
      : baseCurrency;
    if (!card.currencies.includes(currency)) {
      throw new BadRequestException({
        code: CARD_CURRENCY_MISSING,
        message: CARD_CURRENCY_MISSING_MESSAGE,
      });
    }

    const account = await requireOwnedAccount(
      this.repo,
      userId,
      command.fromAccountId,
    );
    const transactionDate = new Date(command.transactionDate);
    const fromAmounts = await this.resolveAmounts.execute({
      amount: command.amount,
      currency,
      ledgerCurrency: account.currency,
      baseCurrency,
      transactionDate,
    });
    const toAmounts = await this.resolveAmounts.execute({
      amount: command.amount,
      currency,
      ledgerCurrency: currency,
      baseCurrency,
      transactionDate,
    });

    const created = await this.repo.createCardPayment({
      userId,
      command,
      fromAmounts,
      toAmounts,
    });
    if (!created) {
      throw new NotFoundException('Pago de tarjeta inválido');
    }

    void this.outboxDispatcher.processBatch();
    return {
      transferGroupId: created.transferGroupId,
      debit: mapLedgerTransaction(created.debit),
      credit: mapLedgerTransaction(created.credit),
    };
  }
}
