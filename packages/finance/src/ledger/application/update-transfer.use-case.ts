import type { DomainEventRelay } from '@personal-os/contracts';
import { DOMAIN_EVENT_RELAY } from '@personal-os/contracts';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import {
  LEDGER_WRITE_REPOSITORY,
  LEDGER_QUERY_REPOSITORY,
} from '../../shared/application/tokens';
import { decimalToString } from '../../shared/domain/mappers';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import {
  OPERATION_LEG_ROLE,
  TRANSFER_LOCKED,
  TRANSFER_LOCKED_MESSAGE,
  TRANSFER_TARGET_NOT_ACCOUNT,
  TRANSFER_TARGET_NOT_ACCOUNT_MESSAGE,
} from '../../shared/domain/transfer';
import type { CreateTransferCommand } from './commands/ledger.commands';
import type { LedgerWriteRepositoryPort } from './ports/ledger-write.repository.port';
import type { LedgerQueryRepositoryPort } from './ports/ledger-query.repository.port';
import {
  assertDifferentAccounts,
  requireOwnedAccount,
} from './resolve-ledger-currency';

@Injectable()
export class UpdateTransferUseCase {
  constructor(
    @Inject(LEDGER_WRITE_REPOSITORY)
    private readonly repo: LedgerWriteRepositoryPort,
    @Inject(LEDGER_QUERY_REPOSITORY)
    private readonly query: LedgerQueryRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
  ) {}

  async execute(
    userId: string,
    legId: string,
    command: Partial<CreateTransferCommand>,
  ) {
    const leg = await this.query.findTransactionById(legId, userId);
    if (!leg) {
      throw new NotFoundException('Transacción no encontrada');
    }
    if (!leg.transferGroupId) {
      throw new BadRequestException('No es una transferencia');
    }

    const legs = await this.query.findTransactionsByTransferGroupId(
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
      throw new NotFoundException(
        'No se encontraron los movimientos de la transferencia',
      );
    }
    if (!legs.every((item) => item.status === 'PENDING')) {
      throw new ConflictException({
        code: TRANSFER_LOCKED,
        message: TRANSFER_LOCKED_MESSAGE,
      });
    }
    if (debit.cardId || credit.cardId) {
      throw new BadRequestException({
        code: TRANSFER_TARGET_NOT_ACCOUNT,
        message: TRANSFER_TARGET_NOT_ACCOUNT_MESSAGE,
      });
    }

    const fromAccountId = command.fromAccountId ?? debit.accountId;
    const toAccountId = command.toAccountId ?? credit.accountId;
    if (!fromAccountId || !toAccountId) {
      throw new BadRequestException({
        code: TRANSFER_TARGET_NOT_ACCOUNT,
        message: TRANSFER_TARGET_NOT_ACCOUNT_MESSAGE,
      });
    }
    assertDifferentAccounts(fromAccountId, toAccountId);

    const fromAccount = await requireOwnedAccount(
      this.query,
      userId,
      fromAccountId,
    );
    const toAccount = await requireOwnedAccount(
      this.query,
      userId,
      toAccountId,
    );

    const baseCurrency = await this.baseCurrency.execute(userId);
    const currency = normalizeCurrencyCode(command.currency ?? debit.currency);
    const transactionDate = command.transactionDate
      ? new Date(command.transactionDate)
      : debit.transactionDate;
    const amount = command.amount ?? Number(decimalToString(debit.amount));

    const fromAmounts = await this.resolveAmounts.execute({
      amount,
      currency,
      ledgerCurrency: fromAccount.currency,
      baseCurrency,
      transactionDate,
    });
    const crossCurrency = currency !== toAccount.currency;
    const existingRate = Number(decimalToString(credit.exchangeRate));
    const keepExistingRate =
      crossCurrency &&
      command.exchangeRate === undefined &&
      command.receivedAmount === undefined;
    const destination = await this.resolveAmounts.resolveTransferDestination({
      sourceAmount: amount,
      sourceCurrency: currency,
      destinationCurrency: toAccount.currency,
      receivedAmount: command.receivedAmount,
      exchangeRate: keepExistingRate ? existingRate : command.exchangeRate,
      baseCurrency,
      transactionDate,
    });
    const toAmounts = destination.amounts;
    const estimated = keepExistingRate
      ? Boolean(credit.isEstimated)
      : destination.estimated;
    const feeAmounts = command.fee
      ? await this.resolveAmounts.execute({
          amount: command.fee.amount,
          currency,
          ledgerCurrency: fromAccount.currency,
          baseCurrency,
          transactionDate,
        })
      : undefined;

    const updated = await this.repo.updateTransfer({
      userId,
      debitId: debit.id,
      creditId: credit.id,
      debitTarget: { accountId: fromAccountId, cardId: null },
      creditTarget: { accountId: toAccountId, cardId: null },
      fromAmounts,
      toAmounts,
      estimated,
      transactionDate,
      description: command.description,
      notes: command.notes,
      ...(command.fee
        ? {
            feeAmounts,
            feeCategoryId: command.fee.categoryId ?? null,
          }
        : {}),
    });
    if (!updated) {
      throw new NotFoundException(
        'No se encontraron los movimientos de la transferencia',
      );
    }

    void this.relay.wake();
    return { success: true };
  }
}
