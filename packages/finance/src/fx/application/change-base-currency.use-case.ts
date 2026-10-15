import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Env } from '@personal-os/config';
import { AppEvents } from '@personal-os/core';
import { Prisma, PrismaService } from '@personal-os/database';
import {
  DEFAULT_MODULE_CONFIG_BY_SLUG,
  mergeWithDefaults,
} from '@personal-os/users';
import { EXCHANGE_RATE_PORT } from '../../shared/application/tokens';
import {
  convertDecimal,
  isIsoCurrency,
  normalizeCurrencyCode,
  roundDecimal,
  type MoneyLike,
} from '../../shared/domain/money';
import type { ExchangeRatePort } from './ports/exchange-rate.port';

const FINANCE_MODULE_SLUG = 'finance';

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
      DEFAULT_MODULE_CONFIG_BY_SLUG.finance as unknown as Record<
        string,
        unknown
      >,
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

    const transactions = await this.prisma.finTransaction.findMany({
      where: { userId },
      select: transactionSelect,
    });
    const rebasedTransactions = await this.rebaseTransactions(
      transactions,
      nextBaseCurrency,
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
        ),
        amountSpent: this.sumSpent(transactions, baseAmountById, budget),
      })),
    );

    const nextConfig = this.buildNextConfig(
      currentConfig,
      nextBaseCurrency,
      previousBaseCurrency,
    );

    await this.prisma.$transaction(async (tx) => {
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
    });

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
  ): Promise<Array<{ id: string; amountBaseCurrency: Prisma.Decimal }>> {
    return Promise.all(
      transactions.map(async (transaction) => ({
        id: transaction.id,
        amountBaseCurrency: await this.convertToBase(
          transaction.amount,
          transaction.currency,
          nextBaseCurrency,
          transaction.transactionDate,
        ),
      })),
    );
  }

  private async rebaseLimit(
    amountLimit: Prisma.Decimal,
    previousBaseCurrency: string,
    nextBaseCurrency: string,
    periodStart: Date,
  ): Promise<Prisma.Decimal> {
    const rate = await this.requireRate(
      previousBaseCurrency,
      nextBaseCurrency,
      periodStart,
    );
    return convertDecimal(amountLimit, rate);
  }

  private async convertToBase(
    amount: MoneyLike,
    currency: string,
    nextBaseCurrency: string,
    date: Date,
  ): Promise<Prisma.Decimal> {
    const from = normalizeCurrencyCode(currency);
    if (from === nextBaseCurrency) {
      return roundDecimal(amount);
    }
    const rate = await this.requireRate(from, nextBaseCurrency, date);
    return convertDecimal(amount, rate);
  }

  private async requireRate(
    from: string,
    to: string,
    date: Date,
  ): Promise<number> {
    const day = date.toISOString().slice(0, 10);
    const rateResult = await this.rates.getHistoricalRate({
      from,
      to,
      date: day,
    });
    if (!rateResult.ok) {
      throw new BadRequestException(
        `Exchange rate unavailable for ${from}->${to} on ${day}: ${rateResult.message}`,
      );
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
