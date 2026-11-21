import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EXCHANGE_RATE_PORT } from '../../shared/application/tokens';
import {
  isIsoCurrency,
  normalizeCurrencyCode,
} from '../../shared/domain/money';
import type { ExchangeRatePort } from './ports/exchange-rate.port';

export type ExchangeRateQuote = {
  currency: string;
  rate: string | null;
};

export type ExchangeRatesResult = {
  baseCurrency: string;
  date: string;
  rates: ExchangeRateQuote[];
};

/** Display-only quotes in the user's base currency; missing rates are null. */
@Injectable()
export class GetExchangeRatesUseCase {
  constructor(
    @Inject(EXCHANGE_RATE_PORT)
    private readonly rates: ExchangeRatePort,
  ) {}

  async execute(
    baseCurrency: string,
    quotes: readonly string[],
    asOf: Date,
  ): Promise<ExchangeRatesResult> {
    const base = normalizeCurrencyCode(baseCurrency);
    if (!isIsoCurrency(base)) {
      throw new BadRequestException(
        `Código de moneda inválido: ${baseCurrency}`,
      );
    }
    const codes = quotes.map((quote) => normalizeCurrencyCode(quote));
    const invalidQuote = codes.find((code) => !isIsoCurrency(code));
    if (invalidQuote) {
      throw new BadRequestException(
        `Código de moneda inválido: ${invalidQuote}`,
      );
    }

    const date = asOf.toISOString().slice(0, 10);
    const rateByCurrency = new Map<string, Promise<string | null>>();
    const rates = await Promise.all(
      codes.map(async (currency) => {
        let rate = rateByCurrency.get(currency);
        if (!rate) {
          rate = this.quoteRate(currency, base, date);
          rateByCurrency.set(currency, rate);
        }
        return { currency, rate: await rate };
      }),
    );

    return { baseCurrency: base, date, rates };
  }

  private async quoteRate(
    currency: string,
    baseCurrency: string,
    date: string,
  ): Promise<string | null> {
    const rateResult = await this.rates.getHistoricalRate({
      from: currency,
      to: baseCurrency,
      date,
    });
    return rateResult.ok ? String(rateResult.rate) : null;
  }
}
