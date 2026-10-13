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
import { normalizeCurrencyCode } from '../../shared/domain/money';
import {
  ACCOUNT_NOT_FOUND,
  ACCOUNT_NOT_FOUND_MESSAGE,
  SAME_ACCOUNT,
  SAME_ACCOUNT_MESSAGE,
  TRANSFER_TARGET_NOT_ACCOUNT,
  TRANSFER_TARGET_NOT_ACCOUNT_MESSAGE,
} from '../../shared/domain/transfer';
import type { CreateTransferCommand } from './commands/ledger.commands';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

@Injectable()
export class CreateTransferUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(userId: string, command: CreateTransferCommand) {
    const baseCurrency = await this.baseCurrency.execute(userId);
    const currency = command.currency
      ? normalizeCurrencyCode(command.currency)
      : baseCurrency;

    if (
      command.fromAccountId &&
      command.toAccountId &&
      command.fromAccountId === command.toAccountId
    ) {
      throw new BadRequestException({
        code: SAME_ACCOUNT,
        message: SAME_ACCOUNT_MESSAGE,
      });
    }

    const fromLedgerCurrency = await this.resolveTargetLedgerCurrency(
      userId,
      command.fromAccountId,
      command.fromCardId,
      currency,
    );
    const toLedgerCurrency = await this.resolveTargetLedgerCurrency(
      userId,
      command.toAccountId,
      undefined,
      currency,
    );

    const fromAmounts = await this.resolveAmounts.execute({
      amount: command.amount,
      currency,
      ledgerCurrency: fromLedgerCurrency,
      baseCurrency,
      transactionDate: new Date(command.transactionDate),
    });
    const toAmounts = await this.resolveAmounts.execute({
      amount: command.amount,
      currency,
      ledgerCurrency: toLedgerCurrency,
      baseCurrency,
      transactionDate: new Date(command.transactionDate),
    });

    const feeAmounts = command.fee
      ? await this.resolveAmounts.execute({
          amount: command.fee.amount,
          currency,
          ledgerCurrency: fromLedgerCurrency,
          baseCurrency,
          transactionDate: new Date(command.transactionDate),
        })
      : undefined;

    const created = await this.repo.createTransfer({
      userId,
      command,
      fromAmounts,
      toAmounts,
      feeAmounts,
    });
    if (!created) {
      throw new NotFoundException('Invalid transfer accounts');
    }

    void this.outboxDispatcher.processBatch();
    const suggestGoalId = command.toAccountId
      ? await this.repo.findSavingsGoalIdByAccount(userId, command.toAccountId)
      : null;
    return {
      transferGroupId: created.transferGroupId,
      debit: mapLedgerTransaction(created.debit),
      credit: mapLedgerTransaction(created.credit),
      ...(suggestGoalId ? { suggestGoalId } : {}),
    };
  }

  private async resolveTargetLedgerCurrency(
    userId: string,
    accountId: string | undefined,
    cardId: string | undefined,
    fallbackCurrency: string,
  ): Promise<string> {
    if (accountId) {
      const account = await this.repo.findAccountById(accountId, userId);
      if (!account) {
        throw new NotFoundException({
          code: ACCOUNT_NOT_FOUND,
          message: ACCOUNT_NOT_FOUND_MESSAGE,
        });
      }
      return account.currency;
    }
    if (cardId) {
      return fallbackCurrency;
    }
    throw new BadRequestException({
      code: TRANSFER_TARGET_NOT_ACCOUNT,
      message: TRANSFER_TARGET_NOT_ACCOUNT_MESSAGE,
    });
  }
}
