import { Inject, Injectable } from '@nestjs/common';
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
import type {
  ExchangeRatePort,
  ExchangeRateResult,
} from './ports/exchange-rate.port';
import { exchangeRateFailureException } from './exchange-rate-failure';

export type FxRateRequestCache = Map<string, Promise<ExchangeRateResult>>;

export type BaseCurrencyConversion = {
  amount: MoneyLike;
  currency: string;
  baseCurrency: string;
  asOf: Date;
  cache?: FxRateRequestCache;
};

type RateRequest = {
  from: string;
  to: string;
  date: string;
  cache?: FxRateRequestCache;
};

type FxRateKind = 'historical' | 'latest' | 'ledger';

type RateKeyInput = {
  kind: FxRateKind;
  from: string;
  to: string;
  date: string;
};

function rateKey({ kind, from, to, date }: RateKeyInput): string {
  return `${kind}:${from}:${to}:${date}`;
}

function cachedRate(
  cache: FxRateRequestCache | undefined,
  key: string,
  load: () => Promise<ExchangeRateResult>,
): Promise<ExchangeRateResult> {
  if (!cache) {
    return load();
  }
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const pending = load();
  cache.set(key, pending);
  return pending;
}

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

    const ledgerRate = await this.requireRate({
      from: currency,
      to: ledgerCurrency,
      date,
    });
    const ledgerAmount = convertAmount(params.amount, ledgerRate.rate);

    const baseRate = await this.requireRate({
      from: currency,
      to: baseCurrency,
      date,
    });
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
  async toBaseCurrency({
    amount,
    currency,
    baseCurrency,
    asOf,
    cache,
  }: BaseCurrencyConversion): Promise<Prisma.Decimal> {
    const from = normalizeCurrencyCode(currency);
    const target = normalizeCurrencyCode(baseCurrency);
    const date = asOf.toISOString().slice(0, 10);
    const rate = await this.requireRate({ from, to: target, date, cache });
    return convertDecimal(amount, rate.rate);
  }

  /**
   * Convert a position amount to the user's base currency, tolerating a
   * missing exact-day rate: it falls back to the latest cached rate on or
   * before `asOf`. Returns `null` when no rate exists, so a display summary can
   * show an incomplete total instead of failing the whole response.
   */
  async toBaseCurrencyOrNull({
    amount,
    currency,
    baseCurrency,
    asOf,
    cache,
  }: BaseCurrencyConversion): Promise<Prisma.Decimal | null> {
    const from = normalizeCurrencyCode(currency);
    const target = normalizeCurrencyCode(baseCurrency);
    const date = asOf.toISOString().slice(0, 10);
    const ledger = cache?.get(
      rateKey({ kind: 'ledger', from, to: target, date }),
    );
    if (ledger) {
      const ledgerResult = await ledger;
      if (ledgerResult.ok) {
        return convertDecimal(amount, ledgerResult.rate);
      }
    }
    const exact = await cachedRate(
      cache,
      rateKey({ kind: 'historical', from, to: target, date }),
      () =>
        this.rates.getHistoricalRate({
          from,
          to: target,
          date,
        }),
    );
    if (exact.ok) {
      return convertDecimal(amount, exact.rate);
    }
    const latest = await cachedRate(
      cache,
      rateKey({ kind: 'latest', from, to: target, date }),
      () =>
        this.rates.getLatestRateOnOrBefore({
          from,
          to: target,
          date,
        }),
    );
    if (!latest.ok) {
      return null;
    }
    return convertDecimal(amount, latest.rate);
  }

  private async requireRate({
    from,
    to,
    date,
    cache,
  }: RateRequest): Promise<{ rate: number; rateDate: string }> {
    const exactKey = rateKey({ kind: 'historical', from, to, date });
    const cachedExact = cache?.get(exactKey);
    if (cachedExact) {
      const exact = await cachedExact;
      if (exact.ok) {
        return { rate: exact.rate, rateDate: exact.rateDate ?? date };
      }
    }
    const rateResult = await cachedRate(
      cache,
      rateKey({ kind: 'ledger', from, to, date }),
      () => this.rates.getLedgerRate({ from, to, date }),
    );
    if (rateResult.ok) {
      if (cache && rateResult.rateDate === date) {
        cache.set(exactKey, Promise.resolve(rateResult));
      }
      return { rate: rateResult.rate, rateDate: rateResult.rateDate ?? date };
    }
    throw exchangeRateFailureException({
      from,
      to,
      date,
      failure: rateResult,
    });
  }
}
