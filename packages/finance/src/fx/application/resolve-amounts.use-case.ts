import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EXCHANGE_RATE_PORT } from '../../shared/application/tokens';
import {
  convertAmount,
  normalizeCurrencyCode,
  type ResolvedAmounts,
} from '../../shared/domain/money';
import type { ExchangeRatePort } from './ports/exchange-rate.port';

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
    const ledgerAmount = convertAmount(params.amount, ledgerRate);

    const baseRate = await this.requireRate(currency, baseCurrency, date);
    const amountBaseCurrency = convertAmount(params.amount, baseRate);

    return {
      amount: params.amount,
      currency,
      ledgerAmount,
      ledgerCurrency,
      amountBaseCurrency,
      exchangeRate: ledgerRate,
    };
  }

  /**
   * Convert a position amount to the user's base currency using the exact
   * calendar date (UTC `YYYY-MM-DD`). Same fail-closed policy as ledger
   * writes: identity when currencies match; otherwise cache/API for that date.
   */
  async toBaseCurrency(
    amount: number,
    currency: string,
    baseCurrency: string,
    asOf: Date,
  ): Promise<number> {
    const from = normalizeCurrencyCode(currency);
    const target = normalizeCurrencyCode(baseCurrency);
    const date = asOf.toISOString().slice(0, 10);
    const rate = await this.requireRate(from, target, date);
    return convertAmount(amount, rate);
  }

  private async requireRate(
    from: string,
    to: string,
    date: string,
  ): Promise<number> {
    const result = await this.rates.getHistoricalRate({ from, to, date });
    if (!result.ok) {
      throw new BadRequestException(
        `Exchange rate unavailable for ${from}->${to} on ${date}: ${result.message}`,
      );
    }
    return result.rate;
  }
}
