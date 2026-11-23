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
  isIsoCurrency,
  normalizeCurrencyCode,
} from '../../shared/domain/money';
import type { ExchangeRatePort } from './ports/exchange-rate.port';
import {
  BaseCurrencyRebase,
  REBASE_BUDGET_SELECT,
  REBASE_TRANSACTION_SELECT,
  type RateCache,
  type RebasedBudget,
  type RebasedTransaction,
} from './base-currency-rebase';
import { FinanceBaseCurrencySettings } from './base-currency-settings';

const FINANCE_MODULE_SLUG = 'finance';

export const CHANGE_BASE_CURRENCY_TIMEOUT_MS = 30_000;
export const BASE_CURRENCY_CHANGED_CODE = 'BASE_CURRENCY_CHANGED';

type FinanceUserModule = {
  id: string;
  config: Prisma.JsonValue;
};

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
  private readonly settings: FinanceBaseCurrencySettings;
  private readonly rebase: BaseCurrencyRebase;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EXCHANGE_RATE_PORT) rates: ExchangeRatePort,
    config: ConfigService<Env, true>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.settings = new FinanceBaseCurrencySettings(config);
    this.rebase = new BaseCurrencyRebase(rates);
  }

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
    const previousBaseCurrency = this.settings.previousFrom(
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
      select: REBASE_TRANSACTION_SELECT,
    });
    const rebasedTransactions = await this.rebase.rebaseTransactions({
      transactions,
      nextBaseCurrency,
      rateCache,
    });
    const baseAmountById = new Map(
      rebasedTransactions.map((row) => [row.id, row.amountBaseCurrency]),
    );

    const budgets = await this.prisma.finBudget.findMany({
      where: { userId },
      select: REBASE_BUDGET_SELECT,
    });
    const rebasedBudgets = await this.rebase.rebaseBudgets({
      budgets,
      transactions,
      baseAmountById,
      previousBaseCurrency,
      nextBaseCurrency,
      rateCache,
    });
    const nextConfig = this.settings.withBaseCurrency(
      currentConfig,
      nextBaseCurrency,
      previousBaseCurrency,
    );

    await this.prisma.$transaction(
      (tx) =>
        this.persistRebase({
          tx,
          userModule,
          rebasedTransactions,
          rebasedBudgets,
          nextConfig,
          previousBaseCurrency,
        }),
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

  private async persistRebase({
    tx,
    userModule,
    rebasedTransactions,
    rebasedBudgets,
    nextConfig,
    previousBaseCurrency,
  }: {
    tx: Prisma.TransactionClient;
    userModule: FinanceUserModule | null;
    rebasedTransactions: RebasedTransaction[];
    rebasedBudgets: RebasedBudget[];
    nextConfig: Record<string, unknown>;
    previousBaseCurrency: string;
  }): Promise<void> {
    if (userModule) {
      const storedModule = await tx.userModule.findUnique({
        where: { id: userModule.id },
        select: { config: true },
      });
      const storedConfig = storedModule?.config as
        { baseCurrency?: unknown } | null | undefined;
      const storedBaseCurrency = this.settings.previousFrom(
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
  }
}
