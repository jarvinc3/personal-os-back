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
  LEDGER_QUERY_REPOSITORY,
  LEDGER_WRITE_REPOSITORY,
} from '../../shared/application/tokens';
import {
  CARD_CURRENCY_MISSING,
  CARD_CURRENCY_MISSING_MESSAGE,
  CARD_NOT_CREDIT,
  CARD_NOT_CREDIT_MESSAGE,
  CARD_NOT_FOUND,
  CARD_NOT_FOUND_MESSAGE,
  CARD_PAYMENT_POSSIBLE_DUPLICATE,
  CARD_PAYMENT_POSSIBLE_DUPLICATE_MESSAGE,
} from '../../shared/domain/card-payment';
import { decimalToString } from '../../shared/domain/mappers';
import type { PossibleManualCardPaymentDuplicate } from './find-manual-card-payment-duplicate';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type { CreateCardPaymentCommand } from './commands/ledger.commands';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerQueryRepositoryPort } from './ports/ledger-query.repository.port';
import type { LedgerWriteRepositoryPort } from './ports/ledger-write.repository.port';
import { requireOwnedAccount } from './resolve-ledger-currency';

@Injectable()
export class CreateCardPaymentUseCase {
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
      this.query,
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

    const outcome = await this.repo.createCardPayment({
      userId,
      command,
      fromAmounts,
      toAmounts,
    });
    if (outcome.kind === 'not_written') {
      throw new NotFoundException('Pago de tarjeta inválido');
    }
    if (outcome.kind === 'possible_duplicate') {
      throw new ConflictException(possibleDuplicateError(outcome));
    }

    const created = outcome.payment;
    void this.relay.wake();
    return {
      transferGroupId: created.transferGroupId,
      debit: mapLedgerTransaction(created.debit),
      credit: mapLedgerTransaction(created.credit),
    };
  }
}

/** 409 con el pago importado que ya existe y los datos para mostrarlo. */
function possibleDuplicateError(duplicate: PossibleManualCardPaymentDuplicate) {
  return {
    code: CARD_PAYMENT_POSSIBLE_DUPLICATE,
    message: CARD_PAYMENT_POSSIBLE_DUPLICATE_MESSAGE,
    matchedBy: duplicate.matchedBy,
    candidate: {
      ...duplicate.candidate,
      amount: decimalToString(duplicate.candidate.amount),
      transactionDate: duplicate.candidate.transactionDate.toISOString(),
    },
  };
}
