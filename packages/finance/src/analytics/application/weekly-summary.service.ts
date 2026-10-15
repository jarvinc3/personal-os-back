import { BadRequestException, Injectable } from '@nestjs/common';
import { UsersService } from '@personal-os/users';
import { CatalogService } from '../../catalog/application/catalog.service';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { IngestionService } from '../../ingestion/application/ingestion.service';
import { PlanningService } from '../../planning/application/planning.service';
import { isValidIsoDate } from '../../shared/domain/iso-date';
import { decimalToString } from '../../shared/domain/mappers';
import { roundDecimal, sumMoney, toMoney } from '../../shared/domain/money';
import { AnalyticsService } from './analytics.service';
import type { WeeklySummary } from './weekly-summary.types';

const AVERAGE_WEEKS = 4;
const TOP_CATEGORY_LIMIT = 3;
const BUDGET_RISK_PCT = 80;
const UPCOMING_DAYS = 7;
const PENDING_EMAIL_SCAN = 50;
const MS_PER_DAY = 86_400_000;

function localDateIso(timezone: string | null, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Monday of the week that contains the given date. */
export function weekStartIso(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  const day = date.getUTCDay();
  return addDaysIso(iso, day === 0 ? -6 : 1 - day);
}

/** Monday of the week before the one that contains the given date. */
export function previousWeekStartIso(iso: string): string {
  return addDaysIso(weekStartIso(iso), -7);
}

/** Inclusive upper bound that covers the whole given day. */
function endOfDayIso(iso: string): string {
  return `${iso}T23:59:59.999Z`;
}

function daysUntilDayOfMonth(todayIso: string, day: number): number {
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  let candidate = new Date(Date.UTC(year, month, Math.min(day, lastDay)));
  if (candidate.getTime() < today.getTime()) {
    const nextMonthLastDay = new Date(
      Date.UTC(year, month + 2, 0),
    ).getUTCDate();
    candidate = new Date(
      Date.UTC(year, month + 1, Math.min(day, nextMonthLastDay)),
    );
  }
  return Math.round((candidate.getTime() - today.getTime()) / MS_PER_DAY);
}

function dateOnly(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

@Injectable()
export class WeeklySummaryService {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly planning: PlanningService,
    private readonly catalog: CatalogService,
    private readonly ingestion: IngestionService,
    private readonly users: UsersService,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {}

  async build(userId: string, weekStartInput?: string): Promise<WeeklySummary> {
    const profile = await this.users.findById(userId);
    const today = localDateIso(profile.timezone, new Date());
    const weekStart = this.resolveWeekStart(weekStartInput, today);
    const weekEnd = addDaysIso(weekStart, 6);
    const rangeFrom = addDaysIso(weekStart, -7 * AVERAGE_WEEKS);

    const [
      currency,
      overTime,
      spendingByCategory,
      budgets,
      loans,
      cards,
      pending,
    ] = await Promise.all([
      this.baseCurrency.execute(userId),
      this.analytics.getSpendingOverTime(
        userId,
        rangeFrom,
        endOfDayIso(weekEnd),
        'week',
      ),
      this.analytics.getSpendingByCategory(
        userId,
        weekStart,
        endOfDayIso(weekEnd),
      ),
      this.analytics.getBudgetStatus(userId),
      this.planning.listLoans(userId),
      this.catalog.listCards(userId),
      this.ingestion.listPendingAssignment(userId, {
        limit: PENDING_EMAIL_SCAN,
      }),
    ]);

    const weeklyPoints = overTime.points.map((point) => ({
      date: point.date,
      expenses: toMoney(point.expenses),
    }));
    const currentExpenses =
      weeklyPoints.find((point) => point.date === weekStart)?.expenses ??
      toMoney(0);
    const previous = weeklyPoints
      .filter((point) => point.date < weekStart)
      .slice(-AVERAGE_WEEKS);
    // The weekly average divides exact decimals, then rounds once to cents.
    const averageExpenses =
      previous.length > 0
        ? roundDecimal(
            sumMoney(previous.map((point) => point.expenses)).div(
              previous.length,
            ),
          )
        : roundDecimal(0);

    const horizon = addDaysIso(today, UPCOMING_DAYS);

    return {
      weekStart,
      weekEnd,
      currency,
      expenses: decimalToString(roundDecimal(currentExpenses)),
      averageExpenses: decimalToString(averageExpenses),
      topCategories: spendingByCategory
        .filter((category) => toMoney(category.total).gt(0))
        .slice(0, TOP_CATEGORY_LIMIT)
        .map((category) => ({
          name: category.name,
          icon: category.icon,
          color: category.color,
          total: category.total,
        })),
      budgetsAtRisk: budgets
        .filter((budget) => budget.pctUsed >= BUDGET_RISK_PCT)
        .map((budget) => ({
          id: budget.id,
          name: budget.category,
          pctUsed: budget.pctUsed,
          spent: budget.amountSpent,
          limit: budget.amountLimit,
        })),
      upcomingInstallments: loans.flatMap((loan) => {
        const dueDate = dateOnly(loan.nextDueDate);
        if (!dueDate || dueDate < today || dueDate > horizon) {
          return [];
        }
        return [
          {
            loanId: loan.id,
            lenderName: loan.lenderName,
            amount: loan.installmentAmount,
            currency: loan.currency,
            dueDate,
          },
        ];
      }),
      cardDueDates: cards.flatMap((card) => {
        if (card.paymentDueDay === null || !card.isActive) {
          return [];
        }
        const diff = daysUntilDayOfMonth(today, card.paymentDueDay);
        if (diff < 0 || diff > UPCOMING_DAYS) {
          return [];
        }
        return [
          {
            cardId: card.id,
            name: card.name,
            lastFour: card.lastFour,
            dueDay: card.paymentDueDay,
          },
        ];
      }),
      pendingEmails: pending.items.length,
    };
  }

  private resolveWeekStart(
    weekStartInput: string | undefined,
    today: string,
  ): string {
    if (weekStartInput === undefined) {
      return weekStartIso(today);
    }
    if (!isValidIsoDate(weekStartInput)) {
      throw new BadRequestException(
        'weekStart must be a real calendar date in YYYY-MM-DD format',
      );
    }
    return weekStartIso(weekStartInput);
  }
}
