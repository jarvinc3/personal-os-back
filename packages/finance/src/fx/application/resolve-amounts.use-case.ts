import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import { EXCHANGE_RATE_PORT } from '../../shared/application/tokens';
import {
  convertAmount,
  convertDecimal,
  normalizeCurrencyCode,
  roundRate,
  type MoneyLike,
  type ResolvedAmounts,
} from '../../shared/domain/money';
import type { ExchangeRatePort } from './ports/exchange-rate.port';

export type TransferDestinationInput = {
  sourceAmount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  receivedAmount?: number;
  exchangeRate?: number;
  baseCurrency: string;
  transactionDate: Date;
};

export type TransferDestinationAmounts = {
  amounts: ResolvedAmounts;
  estimated: boolean;
};

@Injectable()
export class ResolveAmountsUseCase {
  constructor(
    @Inject(EXCHANGE_RATE_PORT)
    private readonly rates: ExchangeRatePort,
  ) {}

  async execute(params: {
    amount: number;
    currency: string;
    ledgerCurrency: string;
    baseCurrency: string;
    transactionDate: Date;
  }): Promise<ResolvedAmounts> {
    const currency = normalizeCurrencyCode(params.currency);
    const ledgerCurrency = normalizeCurrencyCode(params.ledgerCurrency);
    const baseCurrency = normalizeCurrencyCode(params.baseCurrency);
    const date = params.transactionDate.toISOString().slice(0, 10);

    const ledgerRate = await this.requireRate(currency, ledgerCurrency, date);
    const ledgerAmount = convertAmount(params.amount, ledgerRate.rate);

    const baseRate = await this.requireRate(currency, baseCurrency, date);
    const amountBaseCurrency = convertAmount(params.amount, baseRate.rate);

    return {
      amount: params.amount,
      currency,
      ledgerAmount,
      ledgerCurrency,
      amountBaseCurrency,
      exchangeRate: ledgerRate.rate,
      exchangeRateDate: ledgerRate.rateDate,
      baseExchangeRate: baseRate.rate,
      baseExchangeRateDate: baseRate.rateDate,
    };
  }

  /**
   * Destination leg of a transfer. A received amount wins over a rate; without
   * either, the market quote is used and the transfer is marked as estimated.
   */
  async resolveTransferDestination(
    input: TransferDestinationInput,
  ): Promise<TransferDestinationAmounts> {
    const sourceCurrency = normalizeCurrencyCode(input.sourceCurrency);
    const destinationCurrency = normalizeCurrencyCode(
      input.destinationCurrency,
    );
    const crossCurrency = sourceCurrency !== destinationCurrency;

    if (input.receivedAmount !== undefined) {
      const received = input.receivedAmount;
      return {
        amounts: await this.fromDestinationAmount({
          received,
          pairRate: roundRate(received / input.sourceAmount),
          destinationCurrency,
          baseCurrency: input.baseCurrency,
          transactionDate: input.transactionDate,
        }),
        estimated: false,
      };
    }

    if (input.exchangeRate !== undefined) {
      return {
        amounts: await this.fromDestinationAmount({
          received: convertAmount(input.sourceAmount, input.exchangeRate),
          pairRate: roundRate(input.exchangeRate),
          destinationCurrency,
          baseCurrency: input.baseCurrency,
          transactionDate: input.transactionDate,
        }),
        estimated: false,
      };
    }

    return {
      amounts: await this.execute({
        amount: input.sourceAmount,
        currency: sourceCurrency,
        ledgerCurrency: destinationCurrency,
        baseCurrency: input.baseCurrency,
        transactionDate: input.transactionDate,
      }),
      estimated: crossCurrency,
    };
  }

  private async fromDestinationAmount(input: {
    received: number;
    pairRate: number;
    destinationCurrency: string;
    baseCurrency: string;
    transactionDate: Date;
  }): Promise<ResolvedAmounts> {
    const converted = await this.execute({
      amount: input.received,
      currency: input.destinationCurrency,
      ledgerCurrency: input.destinationCurrency,
      baseCurrency: input.baseCurrency,
      transactionDate: input.transactionDate,
    });
    return { ...converted, exchangeRate: input.pairRate };
  }

  /**
   * Convert a position amount to the user's base currency using the exact
   * calendar date (UTC `YYYY-MM-DD`). Same fail-closed policy as ledger
   * writes: identity when currencies match; otherwise cache/API for that date.
   */
  async toBaseCurrency(
    amount: MoneyLike,
    currency: string,
    baseCurrency: string,
    asOf: Date,
  ): Promise<Prisma.Decimal> {
    const from = normalizeCurrencyCode(currency);
    const target = normalizeCurrencyCode(baseCurrency);
    const date = asOf.toISOString().slice(0, 10);
    const rate = await this.requireRate(from, target, date);
    return convertDecimal(amount, rate.rate);
  }

  /**
   * Convert a position amount to the user's base currency, tolerating a
   * missing exact-day rate: it falls back to the latest cached rate on or
   * before `asOf`. Returns `null` when no rate exists, so a display summary can
   * show an incomplete total instead of failing the whole response.
   */
  async toBaseCurrencyOrNull(
    amount: MoneyLike,
    currency: string,
    baseCurrency: string,
    asOf: Date,
  ): Promise<Prisma.Decimal | null> {
    const from = normalizeCurrencyCode(currency);
    const target = normalizeCurrencyCode(baseCurrency);
    const date = asOf.toISOString().slice(0, 10);
    const exact = await this.rates.getHistoricalRate({
      from,
      to: target,
      date,
    });
    if (exact.ok) {
      return convertDecimal(amount, exact.rate);
    }
    const latest = await this.rates.getLatestRateOnOrBefore({
      from,
      to: target,
      date,
    });
    if (!latest.ok) {
      return null;
    }
    return convertDecimal(amount, latest.rate);
  }

  private async requireRate(
    from: string,
    to: string,
    date: string,
  ): Promise<{ rate: number; rateDate: string }> {
    const rateResult = await this.rates.getLedgerRate({ from, to, date });
    if (rateResult.ok) {
      return { rate: rateResult.rate, rateDate: rateResult.rateDate ?? date };
    }
    if (
      rateResult.code === 'PROVIDER_UNAUTHORIZED' ||
      rateResult.code === 'PROVIDER_UNAVAILABLE' ||
      rateResult.code === 'API_KEY_MISSING' ||
      rateResult.code === 'PROVIDER_ERROR'
    ) {
      throw new ServiceUnavailableException(
        `Exchange rate provider unavailable for ${from}->${to} on ${date}: ${rateResult.message}`,
      );
    }
    throw new BadRequestException(
      `Exchange rate unavailable for ${from}->${to} on ${date}: ${rateResult.message}`,
    );
  }
}
