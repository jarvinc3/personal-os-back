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
import { roundMoney } from '../../shared/domain/money';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

export type AdjustBalanceCommand = {
  accountId?: string;
  cardId?: string;
  currency?: string;
  balance: number;
  description?: string;
  transactionDate?: Date;
};

@Injectable()
export class AdjustBalanceUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(userId: string, command: AdjustBalanceCommand) {
    const hasAccount = Boolean(command.accountId);
    const hasCard = Boolean(command.cardId);
    if (hasAccount === hasCard) {
      throw new BadRequestException(
        'Indica exactamente uno de accountId o cardId',
      );
    }
    if (hasCard && !command.currency) {
      throw new BadRequestException(
        'Los ajustes de tarjeta requieren una moneda',
      );
    }

    const target = await this.repo.findBalanceAdjustmentTarget(userId, {
      accountId: command.accountId,
      cardId: command.cardId,
      currency: command.currency,
    });
    if (!target) {
      throw new NotFoundException('Cuenta o tarjeta no encontrada');
    }

    const delta = roundMoney(command.balance - target.currentBalance);
    if (delta === 0) {
      return {
        adjusted: false,
        balance: target.currentBalance,
        transaction: null,
      };
    }

    const transactionDate = command.transactionDate ?? new Date();
    const userBaseCurrency = await this.baseCurrency.execute(userId);
    const amounts = await this.resolveAmounts.execute({
      amount: Math.abs(delta),
      currency: target.currency,
      ledgerCurrency: target.currency,
      baseCurrency: userBaseCurrency,
      transactionDate,
    });

    const created = await this.repo.createBalanceAdjustment(userId, {
      accountId: target.accountId,
      cardId: target.cardId,
      amounts: {
        ...amounts,
        ledgerAmount: delta,
      },
      ...(command.description ? { description: command.description } : {}),
      transactionDate,
    });
    if (!created) {
      throw new NotFoundException('Cuenta o tarjeta no encontrada');
    }

    void this.outboxDispatcher.processBatch();
    return {
      adjusted: true,
      balance: command.balance,
      transaction: mapLedgerTransaction(created.transaction),
    };
  }
}
