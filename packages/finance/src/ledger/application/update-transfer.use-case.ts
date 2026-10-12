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
import { decimalToString } from '../../shared/domain/mappers';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type {
  CreateTransferCommand,
  TransactionUpdateFields,
} from './commands/ledger.commands';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';
import { resolveLedgerCurrencyForTarget } from './resolve-ledger-currency';

type TransferLegInput = {
  id: string;
  accountId?: string;
  cardId?: string;
};

@Injectable()
export class UpdateTransferUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(userId: string, legId: string, command: CreateTransferCommand) {
    const leg = await this.repo.findTransactionById(legId, userId);
    if (!leg) {
      throw new NotFoundException('Transaction not found');
    }
    if (!leg.transferGroupId) {
      throw new BadRequestException('Not a transfer');
    }

    const legs = await this.repo.findTransactionsByTransferGroupId(
      leg.transferGroupId,
      userId,
    );
    const debit = legs.find((item) => item.type === 'DEBIT');
    const credit = legs.find((item) => item.type === 'CREDIT');
    if (!debit || !credit) {
      throw new NotFoundException('Transfer legs not found');
    }

    const fromAccountId = command.fromAccountId ?? debit.accountId ?? undefined;
    const fromCardId = command.fromCardId ?? debit.cardId ?? undefined;
    const toAccountId = command.toAccountId ?? credit.accountId ?? undefined;
    const toCardId = command.toCardId ?? credit.cardId ?? undefined;
    if (
      `${fromAccountId ?? ''}:${fromCardId ?? ''}` ===
      `${toAccountId ?? ''}:${toCardId ?? ''}`
    ) {
      throw new BadRequestException('Invalid transfer accounts');
    }

    const baseCurrency = await this.baseCurrency.execute(userId);
    const currency = normalizeCurrencyCode(command.currency ?? debit.currency);
    const transactionDate = new Date(command.transactionDate);
    const amount = command.amount ?? Number(decimalToString(debit.amount));

    const updateLeg = async ({ id, accountId, cardId }: TransferLegInput) => {
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
        baseCurrency,
        transactionDate,
      });
      const fields: TransactionUpdateFields = {
        accountId: accountId ?? null,
        cardId: cardId ?? null,
        amount: amounts.amount,
        currency: amounts.currency,
        ledgerAmount: amounts.ledgerAmount,
        ledgerCurrency: amounts.ledgerCurrency,
        amountBaseCurrency: amounts.amountBaseCurrency,
        exchangeRate: amounts.exchangeRate,
        transactionDate,
        ...(command.description !== undefined
          ? { description: command.description }
          : {}),
        ...(command.notes !== undefined ? { notes: command.notes } : {}),
        ...(command.status !== undefined ? { status: command.status } : {}),
      };
      const updated = await this.repo.updateTransaction(userId, id, fields);
      if (!updated) {
        throw new NotFoundException('Transaction not found');
      }
    };

    await updateLeg({
      id: debit.id,
      accountId: fromAccountId,
      cardId: fromCardId,
    });
    await updateLeg({
      id: credit.id,
      accountId: toAccountId,
      cardId: toCardId,
    });

    void this.outboxDispatcher.processBatch();
    return { success: true };
  }
}
