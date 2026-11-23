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
} from '../../shared/domain/transfer';
import type { CreateCardPaymentCommand } from './commands/ledger.commands';
import type { LedgerWriteRepositoryPort } from './ports/ledger-write.repository.port';
import type { LedgerQueryRepositoryPort } from './ports/ledger-query.repository.port';

@Injectable()
export class UpdateCardPaymentUseCase {
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
    command: Partial<CreateCardPaymentCommand>,
  ) {
    const leg = await this.query.findTransactionById(legId, userId);
    if (!leg) {
      throw new NotFoundException('Transacción no encontrada');
    }
    if (!leg.transferGroupId) {
      throw new BadRequestException('No es un pago de tarjeta');
    }

    const legs = await this.query.findTransactionsByTransferGroupId(
      leg.transferGroupId,
      userId,
    );
    const debit =
      legs.find((item) => item.legRole === OPERATION_LEG_ROLE.SOURCE) ??
      legs.find((item) => item.type === 'CARD_PAYMENT');
    const credit =
      legs.find((item) => item.legRole === OPERATION_LEG_ROLE.DESTINATION) ??
      legs.find((item) => item.cardId !== null);
    if (!debit || !credit) {
      throw new NotFoundException(
        'No se encontraron los movimientos del pago de tarjeta',
      );
    }
    if (debit.type !== 'CARD_PAYMENT') {
      throw new BadRequestException('No es un pago de tarjeta');
    }
    if (!legs.every((item) => item.status === 'PENDING')) {
      throw new ConflictException({
        code: TRANSFER_LOCKED,
        message: TRANSFER_LOCKED_MESSAGE,
      });
    }

    const baseCurrency = await this.baseCurrency.execute(userId);
    const currency = normalizeCurrencyCode(command.currency ?? debit.currency);
    const transactionDate = command.transactionDate
      ? new Date(command.transactionDate)
      : debit.transactionDate;
    const amount = command.amount ?? Number(decimalToString(debit.amount));

    const fromAmounts = await this.resolveAmounts.execute({
      amount,
      currency,
      ledgerCurrency: debit.ledgerCurrency ?? debit.currency,
      baseCurrency,
      transactionDate,
    });
    const toAmounts = await this.resolveAmounts.execute({
      amount,
      currency,
      ledgerCurrency: credit.ledgerCurrency ?? credit.currency,
      baseCurrency,
      transactionDate,
    });

    const updated = await this.repo.updateTransfer({
      userId,
      debitId: debit.id,
      creditId: credit.id,
      debitTarget: { accountId: debit.accountId, cardId: debit.cardId },
      creditTarget: { accountId: credit.accountId, cardId: credit.cardId },
      fromAmounts,
      toAmounts,
      estimated: false,
      transactionDate,
      description: command.description,
      notes: command.notes,
    });
    if (!updated) {
      throw new NotFoundException(
        'No se encontraron los movimientos del pago de tarjeta',
      );
    }

    void this.relay.wake();
    return { success: true };
  }
}
