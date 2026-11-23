import { Prisma } from '@personal-os/database';
import {
  convertDecimal,
  normalizeCurrencyCode,
  roundDecimal,
  type MoneyLike,
} from '../../shared/domain/money';
import type { ExchangeRatePort } from './ports/exchange-rate.port';
import { exchangeRateFailureException } from './exchange-rate-failure';

const REBASE_CONCURRENCY = 25;

export const REBASE_TRANSACTION_SELECT = {
  id: true,
  amount: true,
  currency: true,
  transactionDate: true,
  type: true,
  status: true,
  categoryId: true,
} satisfies Prisma.FinTransactionSelect;

export const REBASE_BUDGET_SELECT = {
  id: true,
  categoryId: true,
  periodStart: true,
  periodEnd: true,
  amountLimit: true,
} satisfies Prisma.FinBudgetSelect;

export type RebaseTransaction = Prisma.FinTransactionGetPayload<{
  select: typeof REBASE_TRANSACTION_SELECT;
}>;

export type RebaseBudget = Prisma.FinBudgetGetPayload<{
  select: typeof REBASE_BUDGET_SELECT;
}>;

export type RateCache = Map<string, Promise<number>>;

export type RebasedTransaction = {
  id: string;
  amountBaseCurrency: Prisma.Decimal;
};

export type RebasedBudget = {
  id: string;
  amountLimit: Prisma.Decimal;
  amountSpent: Prisma.Decimal;
};

/** Converts the stored base amounts of a user to the new base currency. */
export class BaseCurrencyRebase {
  constructor(private readonly rates: ExchangeRatePort) {}

  async rebaseTransactions({
    transactions,
    nextBaseCurrency,
    rateCache,
  }: {
    transactions: readonly RebaseTransaction[];
    nextBaseCurrency: string;
    rateCache: RateCache;
  }): Promise<RebasedTransaction[]> {
    const rebasedTransactions: RebasedTransaction[] = [];
    for (
      let start = 0;
      start < transactions.length;
      start += REBASE_CONCURRENCY
    ) {
      const chunk = transactions.slice(start, start + REBASE_CONCURRENCY);
      const convertedChunk = await Promise.all(
        chunk.map(async (transaction) => ({
          id: transaction.id,
          amountBaseCurrency: await this.convertToBase({
            amount: transaction.amount,
            currency: transaction.currency,
            nextBaseCurrency,
            date: transaction.transactionDate,
            rateCache,
          }),
        })),
      );
      rebasedTransactions.push(...convertedChunk);
    }
    return rebasedTransactions;
  }

  async rebaseBudgets({
    budgets,
    transactions,
    baseAmountById,
    previousBaseCurrency,
    nextBaseCurrency,
    rateCache,
  }: {
    budgets: readonly RebaseBudget[];
    transactions: readonly RebaseTransaction[];
    baseAmountById: Map<string, Prisma.Decimal>;
    previousBaseCurrency: string;
    nextBaseCurrency: string;
    rateCache: RateCache;
  }): Promise<RebasedBudget[]> {
    return Promise.all(
      budgets.map(async (budget) => ({
        id: budget.id,
        amountLimit: await this.rebaseLimit({
          amountLimit: budget.amountLimit,
          previousBaseCurrency,
          nextBaseCurrency,
          periodStart: budget.periodStart,
          rateCache,
        }),
        amountSpent: this.sumSpent(transactions, baseAmountById, budget),
      })),
    );
  }

  private async rebaseLimit({
    amountLimit,
    previousBaseCurrency,
    nextBaseCurrency,
    periodStart,
    rateCache,
  }: {
    amountLimit: Prisma.Decimal;
    previousBaseCurrency: string;
    nextBaseCurrency: string;
    periodStart: Date;
    rateCache: RateCache;
  }): Promise<Prisma.Decimal> {
    const rate = await this.requireRate({
      from: previousBaseCurrency,
      to: nextBaseCurrency,
      date: periodStart,
      rateCache,
    });
    return convertDecimal(amountLimit, rate);
  }

  private async convertToBase({
    amount,
    currency,
    nextBaseCurrency,
    date,
    rateCache,
  }: {
    amount: MoneyLike;
    currency: string;
    nextBaseCurrency: string;
    date: Date;
    rateCache: RateCache;
  }): Promise<Prisma.Decimal> {
    const from = normalizeCurrencyCode(currency);
    if (from === nextBaseCurrency) {
      return roundDecimal(amount);
    }
    const rate = await this.requireRate({
      from,
      to: nextBaseCurrency,
      date,
      rateCache,
    });
    return convertDecimal(amount, rate);
  }

  private async requireRate({
    from,
    to,
    date,
    rateCache,
  }: {
    from: string;
    to: string;
    date: Date;
    rateCache: RateCache;
  }): Promise<number> {
    const day = date.toISOString().slice(0, 10);
    const key = `${from}:${to}:${day}`;
    const cachedRate = rateCache.get(key);
    if (cachedRate) {
      return cachedRate;
    }
    const pendingRate = this.fetchRate(from, to, day);
    rateCache.set(key, pendingRate);
    return pendingRate;
  }

  private async fetchRate(
    from: string,
    to: string,
    day: string,
  ): Promise<number> {
    const rateResult = await this.rates.getLedgerRate({
      from,
      to,
      date: day,
    });
    if (!rateResult.ok) {
      throw exchangeRateFailureException({
        from,
        to,
        date: day,
        failure: rateResult,
      });
    }
    return rateResult.rate;
  }

  private sumSpent(
    transactions: readonly RebaseTransaction[],
    baseAmountById: Map<string, Prisma.Decimal>,
    budget: RebaseBudget,
  ): Prisma.Decimal {
    let spent = new Prisma.Decimal(0);
    for (const transaction of transactions) {
      if (
        transaction.type !== 'DEBIT' ||
        transaction.status !== 'CONFIRMED' ||
        transaction.categoryId !== budget.categoryId
      ) {
        continue;
      }
      const transactionDay = new Date(transaction.transactionDate);
      transactionDay.setUTCHours(0, 0, 0, 0);
      if (
        transactionDay < budget.periodStart ||
        transactionDay > budget.periodEnd
      ) {
        continue;
      }
      spent = spent.plus(baseAmountById.get(transaction.id) ?? 0);
    }
    return roundDecimal(spent);
  }
}
