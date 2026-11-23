import type { DomainEventRelay } from '@personal-os/contracts';
import { DOMAIN_EVENT_RELAY } from '@personal-os/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { withRateMetadata } from '../../fx/application/rate-metadata';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { LEDGER_WRITE_REPOSITORY } from '../../shared/application/tokens';
import type { LedgerWriteRepositoryPort } from './ports/ledger-write.repository.port';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type { TransferStatus } from './commands/ledger.commands';
import type { ImportedCardPaymentOutcome } from './ports/ledger.repository.port';

export type ImportCardPaymentInput = {
  sourceAccountId: string;
  sourceAccountCurrency: string;
  cardId: string;
  amount: number;
  currency: string;
  transactionDate: Date;
  externalReference: string | null;
  importReference: string;
  aiMetadata: unknown;
  description: string;
  notes: string | null;
  status: TransferStatus;
};

/**
 * Mismo pago de dos patas que la ruta manual, con las referencias de la señal.
 * Solo la pata de origen lleva `importReference`: la clave es única por usuario.
 */
@Injectable()
export class ImportCardPaymentUseCase {
  constructor(
    @Inject(LEDGER_WRITE_REPOSITORY)
    private readonly repo: LedgerWriteRepositoryPort,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
  ) {}

  preview(
    userId: string,
    payment: Pick<
      ImportCardPaymentInput,
      | 'sourceAccountId'
      | 'cardId'
      | 'amount'
      | 'currency'
      | 'transactionDate'
      | 'externalReference'
    >,
  ) {
    return this.repo.previewImportedCardPayment({
      userId,
      incoming: {
        accountId: payment.sourceAccountId,
        cardId: payment.cardId,
        amount: payment.amount,
        currency: payment.currency,
        transactionDate: payment.transactionDate,
        bankReference: payment.externalReference,
      },
    });
  }

  async execute(
    userId: string,
    payment: ImportCardPaymentInput,
  ): Promise<ImportedCardPaymentOutcome> {
    const baseCurrency = await this.baseCurrency.execute(userId);
    const currency = normalizeCurrencyCode(payment.currency);
    const fromAmounts = await this.resolveAmounts.execute({
      amount: payment.amount,
      currency,
      ledgerCurrency: payment.sourceAccountCurrency,
      baseCurrency,
      transactionDate: payment.transactionDate,
    });
    const toAmounts = await this.resolveAmounts.execute({
      amount: payment.amount,
      currency,
      ledgerCurrency: currency,
      baseCurrency,
      transactionDate: payment.transactionDate,
    });

    const outcome = await this.repo.createImportedCardPayment({
      userId,
      incoming: {
        accountId: payment.sourceAccountId,
        cardId: payment.cardId,
        amount: payment.amount,
        currency,
        transactionDate: payment.transactionDate,
        bankReference: payment.externalReference,
      },
      command: {
        fromAccountId: payment.sourceAccountId,
        cardId: payment.cardId,
        amount: payment.amount,
        currency,
        transactionDate: payment.transactionDate.toISOString(),
        description: payment.description,
        notes: payment.notes ?? undefined,
        status: payment.status,
        source: 'EMAIL',
        externalReference: payment.externalReference,
        importReference: payment.importReference,
        aiMetadata: withRateMetadata({
          aiMetadata: withRateMetadata({
            aiMetadata: payment.aiMetadata,
            amounts: fromAmounts,
          }),
          amounts: toAmounts,
          scope: 'destination',
        }),
      },
      fromAmounts,
      toAmounts,
    });
    if (outcome.kind === 'created') {
      void this.relay.wake();
    }
    return outcome;
  }
}
