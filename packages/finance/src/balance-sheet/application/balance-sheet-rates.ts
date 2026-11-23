import type { Prisma } from '@personal-os/database';
import type { FxRateRequestCache } from '../../fx/application/resolve-amounts.use-case';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import type { MoneyLike } from '../../shared/domain/money';

type ToBaseInput = {
  amount: MoneyLike;
  currency: string;
  baseCurrency: string;
  asOf: Date;
};

/** One request owns one rate cache, shared by every line and the cash summary. */
export class BalanceSheetRates {
  private readonly cache: FxRateRequestCache = new Map();

  constructor(private readonly resolveAmounts: ResolveAmountsUseCase) {}

  toBase(input: ToBaseInput): Promise<Prisma.Decimal> {
    return this.resolveAmounts.toBaseCurrency({
      amount: input.amount,
      currency: input.currency,
      baseCurrency: input.baseCurrency,
      asOf: input.asOf,
      cache: this.cache,
    });
  }

  toBaseOrNull(input: ToBaseInput): Promise<Prisma.Decimal | null> {
    return this.resolveAmounts.toBaseCurrencyOrNull({
      amount: input.amount,
      currency: input.currency,
      baseCurrency: input.baseCurrency,
      asOf: input.asOf,
      cache: this.cache,
    });
  }
}
