import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Env } from '@personal-os/config';
import { AppEvents } from '@personal-os/core';
import { Prisma, PrismaService } from '@personal-os/database';
import { mergeWithDefaults } from '@personal-os/users';
import { FINANCE_SETTINGS_DEFAULTS } from '../../settings/finance-settings';
import { EXCHANGE_RATE_PORT } from '../../shared/application/tokens';
import {
  convertDecimal,
  isIsoCurrency,
  normalizeCurrencyCode,
  roundDecimal,
  type MoneyLike,
} from '../../shared/domain/money';
import type { ExchangeRatePort } from './ports/exchange-rate.port';
import { exchangeRateFailureException } from './exchange-rate-failure';

const FINANCE_MODULE_SLUG = 'finance';
const REBASE_CONCURRENCY = 25;

export const CHANGE_BASE_CURRENCY_TIMEOUT_MS = 30_000;
export const BASE_CURRENCY_CHANGED_CODE = 'BASE_CURRENCY_CHANGED';

type RateCache = Map<string, Promise<number>>;

const transactionSelect = {
  id: true,
  amount: true,
  currency: true,
  transactionDate: true,
  type: true,
  status: true,
  categoryId: true,
} satisfies Prisma.FinTransactionSelect;

const budgetSelect = {
  id: true,
  categoryId: true,
  periodStart: true,
  periodEnd: true,
  amountLimit: true,
} satisfies Prisma.FinBudgetSelect;

type RebaseTransaction = Prisma.FinTransactionGetPayload<{
  select: typeof transactionSelect;
}>;

type RebaseBudget = Prisma.FinBudgetGetPayload<{
  select: typeof budgetSelect;
}>;

export type ChangeBaseCurrencyResult = {
  baseCurrency: string;
  previousBaseCurrency: string;
  rebasedTransactions: number;
  rebasedBudgets: number;
};

/**
 * Switches the user's base currency and rebases every stored base amount in
 * one transaction. Missing rates abort with 400 before any write.
 */
@Injectable()
export class ChangeBaseCurrencyUseCase {
  private readonly logger = new Logger(ChangeBaseCurrencyUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EXCHANGE_RATE_PORT)
    private readonly rates: ExchangeRatePort,
    private readonly config: ConfigService<Env, true>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(
    userId: string,
    requestedBaseCurrency: string,
  ): Promise<ChangeBaseCurrencyResult> {
    const nextBaseCurrency = normalizeCurrencyCode(requestedBaseCurrency);
    if (!isIsoCurrency(nextBaseCurrency)) {
      throw new BadRequestException(
        `Código de moneda inválido: ${requestedBaseCurrency}`,
      );
    }

    const financeModule = await this.prisma.module.findUnique({
      where: { slug: FINANCE_MODULE_SLUG },
      select: { id: true },
    });
    const userModule = financeModule
      ? await this.prisma.userModule.findUnique({
          where: {
            userId_moduleId: { userId, moduleId: financeModule.id },
          },
          select: { id: true, config: true },
        })
      : null;

    const currentConfig = mergeWithDefaults(
      userModule?.config,
      FINANCE_SETTINGS_DEFAULTS as unknown as Record<string, unknown>,
    );
    const previousBaseCurrency = this.resolvePreviousBaseCurrency(
      currentConfig.baseCurrency,
    );

    if (nextBaseCurrency === previousBaseCurrency) {
      return {
        baseCurrency: nextBaseCurrency,
        previousBaseCurrency,
        rebasedTransactions: 0,
        rebasedBudgets: 0,
      };
    }

    const rateCache: RateCache = new Map();
    const transactions = await this.prisma.finTransaction.findMany({
      where: { userId },
      select: transactionSelect,
    });
    const rebasedTransactions = await this.rebaseTransactions(
      transactions,
      nextBaseCurrency,
      rateCache,
    );
    const baseAmountById = new Map(
      rebasedTransactions.map((row) => [row.id, row.amountBaseCurrency]),
    );

    const budgets = await this.prisma.finBudget.findMany({
      where: { userId },
      select: budgetSelect,
    });
    const rebasedBudgets = await Promise.all(
      budgets.map(async (budget) => ({
        id: budget.id,
        amountLimit: await this.rebaseLimit(
          budget.amountLimit,
          previousBaseCurrency,
          nextBaseCurrency,
          budget.periodStart,
          rateCache,
        ),
        amountSpent: this.sumSpent(transactions, baseAmountById, budget),
      })),
    );

    const nextConfig = this.buildNextConfig(
      currentConfig,
      nextBaseCurrency,
      previousBaseCurrency,
    );

    await this.prisma.$transaction(
      async (tx) => {
        if (userModule) {
          const storedModule = await tx.userModule.findUnique({
            where: { id: userModule.id },
            select: { config: true },
          });
          const storedConfig = storedModule?.config as
            { baseCurrency?: unknown } | null | undefined;
          const storedBaseCurrency = this.resolvePreviousBaseCurrency(
            storedConfig?.baseCurrency,
          );
          if (storedBaseCurrency !== previousBaseCurrency) {
            throw new ConflictException({
              code: BASE_CURRENCY_CHANGED_CODE,
              message:
                'La moneda base cambió mientras se recalculaba; inténtalo de nuevo.',
            });
          }
        }

        for (const row of rebasedTransactions) {
          await tx.finTransaction.update({
            where: { id: row.id },
            data: { amountBaseCurrency: row.amountBaseCurrency },
          });
        }
        for (const budget of rebasedBudgets) {
          await tx.finBudget.update({
            where: { id: budget.id },
            data: {
              amountLimit: budget.amountLimit,
              amountSpent: budget.amountSpent,
            },
          });
        }
        if (userModule) {
          await tx.userModule.update({
            where: { id: userModule.id },
            data: { config: nextConfig as Prisma.InputJsonValue },
          });
        }
      },
      { timeout: CHANGE_BASE_CURRENCY_TIMEOUT_MS },
    );

    this.logger.log(
      `base_currency_changed userId=${userId} from=${previousBaseCurrency} to=${nextBaseCurrency} transactions=${rebasedTransactions.length} budgets=${rebasedBudgets.length}`,
    );
    this.eventEmitter.emit(AppEvents.MODULE_CONFIG_UPDATED, {
      userId,
      slug: FINANCE_MODULE_SLUG,
    });

    return {
      baseCurrency: nextBaseCurrency,
      previousBaseCurrency,
      rebasedTransactions: rebasedTransactions.length,
      rebasedBudgets: rebasedBudgets.length,
    };
  }

  private resolvePreviousBaseCurrency(configured: unknown): string {
    const normalized =
      typeof configured === 'string' ? normalizeCurrencyCode(configured) : '';
    if (isIsoCurrency(normalized)) {
      return normalized;
    }
    return this.config.get('BASE_CURRENCY', { infer: true });
  }

  private async rebaseTransactions(
    transactions: readonly RebaseTransaction[],
    nextBaseCurrency: string,
    rateCache: RateCache,
  ): Promise<Array<{ id: string; amountBaseCurrency: Prisma.Decimal }>> {
    const rebasedTransactions: Array<{
      id: string;
      amountBaseCurrency: Prisma.Decimal;
    }> = [];
    for (
      let start = 0;
      start < transactions.length;
      start += REBASE_CONCURRENCY
    ) {
      const chunk = transactions.slice(start, start + REBASE_CONCURRENCY);
      const convertedChunk = await Promise.all(
        chunk.map(async (transaction) => ({
          id: transaction.id,
          amountBaseCurrency: await this.convertToBase(
            transaction.amount,
            transaction.currency,
            nextBaseCurrency,
            transaction.transactionDate,
            rateCache,
          ),
        })),
      );
      rebasedTransactions.push(...convertedChunk);
    }
    return rebasedTransactions;
  }

  private async rebaseLimit(
    amountLimit: Prisma.Decimal,
    previousBaseCurrency: string,
    nextBaseCurrency: string,
    periodStart: Date,
    rateCache: RateCache,
  ): Promise<Prisma.Decimal> {
    const rate = await this.requireRate(
      previousBaseCurrency,
      nextBaseCurrency,
      periodStart,
      rateCache,
    );
    return convertDecimal(amountLimit, rate);
  }

  private async convertToBase(
    amount: MoneyLike,
    currency: string,
    nextBaseCurrency: string,
    date: Date,
    rateCache: RateCache,
  ): Promise<Prisma.Decimal> {
    const from = normalizeCurrencyCode(currency);
    if (from === nextBaseCurrency) {
      return roundDecimal(amount);
    }
    const rate = await this.requireRate(
      from,
      nextBaseCurrency,
      date,
      rateCache,
    );
    return convertDecimal(amount, rate);
  }

  private async requireRate(
    from: string,
    to: string,
    date: Date,
    rateCache: RateCache,
  ): Promise<number> {
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

  private buildNextConfig(
    currentConfig: Record<string, unknown>,
    nextBaseCurrency: string,
    previousBaseCurrency: string,
  ): Record<string, unknown> {
    const configuredTracked = Array.isArray(currentConfig.trackedCurrencies)
      ? currentConfig.trackedCurrencies
      : [];
    const withoutNext = configuredTracked
      .map((code) => normalizeCurrencyCode(String(code)))
      .filter((code) => code && code !== nextBaseCurrency);

    const trackedCurrencies = [
      previousBaseCurrency,
      ...withoutNext.filter((code) => code !== previousBaseCurrency),
    ];

    return {
      ...currentConfig,
      baseCurrency: nextBaseCurrency,
      trackedCurrencies,
    };
  }
}
