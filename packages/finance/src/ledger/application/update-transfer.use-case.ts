import {
  BadRequestException,
  ConflictException,
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
import {
  OPERATION_LEG_ROLE,
  TRANSFER_LOCKED,
  TRANSFER_LOCKED_MESSAGE,
} from '../../shared/domain/transfer';
import type { CreateTransferCommand } from './commands/ledger.commands';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';
import { resolveLedgerCurrencyForTarget } from './resolve-ledger-currency';

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
    const debit =
      legs.find((item) => item.legRole === OPERATION_LEG_ROLE.SOURCE) ??
      legs.find((item) => item.type === 'DEBIT');
    const credit =
      legs.find((item) => item.legRole === OPERATION_LEG_ROLE.DESTINATION) ??
      legs.find((item) => item.type === 'CREDIT');
    if (!debit || !credit) {
      throw new NotFoundException('Transfer legs not found');
    }
    if (!legs.every((item) => item.status === 'PENDING')) {
      throw new ConflictException({
        code: TRANSFER_LOCKED,
        message: TRANSFER_LOCKED_MESSAGE,
      });
    }

    const fromAccountId = command.fromAccountId ?? debit.accountId ?? null;
    const fromCardId = command.fromCardId ?? debit.cardId ?? null;
    const toAccountId = command.toAccountId ?? credit.accountId ?? null;
    const toCardId = command.toCardId ?? credit.cardId ?? null;
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

    const fromLedgerCurrency = await resolveLedgerCurrencyForTarget(
      this.repo,
      userId,
      fromAccountId ?? undefined,
      fromCardId ?? undefined,
      currency,
    );
    const toLedgerCurrency = await resolveLedgerCurrencyForTarget(
      this.repo,
      userId,
      toAccountId ?? undefined,
      toCardId ?? undefined,
      currency,
    );
    const fromAmounts = await this.resolveAmounts.execute({
      amount,
      currency,
      ledgerCurrency: fromLedgerCurrency,
      baseCurrency,
      transactionDate,
    });
    const toAmounts = await this.resolveAmounts.execute({
      amount,
      currency,
      ledgerCurrency: toLedgerCurrency,
      baseCurrency,
      transactionDate,
    });

    const updated = await this.repo.updateTransfer({
      userId,
      debitId: debit.id,
      creditId: credit.id,
      debitTarget: { accountId: fromAccountId, cardId: fromCardId },
      creditTarget: { accountId: toAccountId, cardId: toCardId },
      fromAmounts,
      toAmounts,
      transactionDate,
      description: command.description,
      notes: command.notes,
    });
    if (!updated) {
      throw new NotFoundException('Transfer legs not found');
    }

    void this.outboxDispatcher.processBatch();
    return { success: true };
  }
}
