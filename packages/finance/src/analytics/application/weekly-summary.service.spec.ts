import { BadRequestException } from '@nestjs/common';
import type { UsersService } from '@personal-os/users';
import type { CatalogService } from '../../catalog/application/catalog.service';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import type { IngestionService } from '../../ingestion/application/ingestion.service';
import type { PlanningService } from '../../planning/application/planning.service';
import type { AnalyticsService } from './analytics.service';
import {
  WeeklySummaryService,
  previousWeekStartIso,
  weekStartIso,
} from './weekly-summary.service';

const WEEK_START = '2026-10-12';

const todayIso = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const todayDayOfMonth = Number(todayIso.slice(8, 10));

type Overrides = {
  overTime?: { points: { date: string; expenses: string; income: string }[] };
  categories?: unknown[];
  budgets?: unknown[];
  loans?: unknown[];
  cards?: unknown[];
  pendingItems?: unknown[];
};

function createService(overrides: Overrides = {}) {
  const analytics = {
    getSpendingOverTime: jest.fn().mockResolvedValue(
      overrides.overTime ?? {
        points: [
          { date: '2026-09-14', expenses: '100', income: '0' },
          { date: '2026-09-21', expenses: '200', income: '0' },
          { date: '2026-09-28', expenses: '300', income: '0' },
          { date: '2026-10-05', expenses: '400', income: '0' },
          { date: WEEK_START, expenses: '500', income: '0' },
        ],
      },
    ),
    getSpendingByCategory: jest.fn().mockResolvedValue(
      overrides.categories ?? [
        { name: 'Comida', icon: null, color: '#f00', total: '300' },
        { name: 'Transporte', icon: null, color: null, total: '150' },
        { name: 'Hogar', icon: null, color: null, total: '50' },
        { name: 'Otros', icon: null, color: null, total: '10' },
      ],
    ),
    getBudgetStatus: jest.fn().mockResolvedValue(
      overrides.budgets ?? [
        {
          id: 'budget-food',
          category: 'Comida',
          pctUsed: 90,
          amountSpent: '900',
          amountLimit: '1000',
        },
        {
          id: 'budget-home',
          category: 'Hogar',
          pctUsed: 40,
          amountSpent: '200',
          amountLimit: '500',
        },
      ],
    ),
  } as unknown as AnalyticsService;
  const planning = {
    listLoans: jest.fn().mockResolvedValue(
      overrides.loans ?? [
        {
          id: 'loan-1',
          lenderName: 'Banco',
          currency: 'DOP',
          installmentAmount: '4500',
          nextDueDate: todayIso,
        },
      ],
    ),
  } as unknown as PlanningService;
  const catalog = {
    listCards: jest.fn().mockResolvedValue(
      overrides.cards ?? [
        {
          id: 'card-1',
          name: 'Visa',
          lastFour: '6506',
          paymentDueDay: todayDayOfMonth,
          isActive: true,
        },
        {
          id: 'card-2',
          name: 'Sin dia',
          lastFour: '1111',
          paymentDueDay: null,
          isActive: true,
        },
      ],
    ),
  } as unknown as CatalogService;
  const ingestion = {
    listPendingAssignment: jest
      .fn()
      .mockResolvedValue({ items: overrides.pendingItems ?? [{}, {}] }),
  } as unknown as IngestionService;
  const users = {
    findById: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
  } as unknown as UsersService;
  const baseCurrency = {
    execute: jest.fn().mockResolvedValue('DOP'),
  } as unknown as ResolveUserBaseCurrencyUseCase;

  return new WeeklySummaryService(
    analytics,
    planning,
    catalog,
    ingestion,
    users,
    baseCurrency,
  );
}

describe('weekStartIso', () => {
  it('returns the Monday of the week', () => {
    expect(weekStartIso('2026-10-12')).toBe('2026-10-12');
    expect(weekStartIso('2026-10-14')).toBe('2026-10-12');
    expect(weekStartIso('2026-10-18')).toBe('2026-10-12');
  });
});

describe('previousWeekStartIso', () => {
  it('returns the Monday of the week before', () => {
    expect(previousWeekStartIso('2026-10-19')).toBe('2026-10-12');
    expect(previousWeekStartIso('2026-10-14')).toBe('2026-10-05');
    expect(previousWeekStartIso('2026-10-18')).toBe('2026-10-05');
  });
});

describe('WeeklySummaryService', () => {
  it('compares the week against the four previous weeks', async () => {
    const summary = await createService().build('user-1', WEEK_START);

    expect(summary.weekStart).toBe(WEEK_START);
    expect(summary.weekEnd).toBe('2026-10-18');
    expect(summary.expenses).toBe('500');
    expect(summary.averageExpenses).toBe('250');
    expect(summary.currency).toBe('DOP');
  });

  it('keeps the top three categories', async () => {
    const summary = await createService().build('user-1', WEEK_START);

    expect(summary.topCategories.map((category) => category.name)).toEqual([
      'Comida',
      'Transporte',
      'Hogar',
    ]);
  });

  it('normalizes a valid date to the Monday of its week', async () => {
    const summary = await createService().build('user-1', '2026-10-14');

    expect(summary.weekStart).toBe(WEEK_START);
  });

  it('rejects an impossible weekStart instead of failing later', async () => {
    await expect(createService().build('user-1', '2026-02-31')).rejects.toThrow(
      BadRequestException,
    );
    await expect(createService().build('user-1', '2026-13-01')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('only lists budgets at or above the risk threshold', async () => {
    const summary = await createService().build('user-1', WEEK_START);

    expect(summary.budgetsAtRisk).toHaveLength(1);
    expect(summary.budgetsAtRisk[0]).toMatchObject({
      id: 'budget-food',
      pctUsed: 90,
    });
  });

  it('includes upcoming installments, card due dates and pending emails', async () => {
    const summary = await createService().build('user-1', WEEK_START);

    expect(summary.upcomingInstallments).toEqual([
      {
        loanId: 'loan-1',
        lenderName: 'Banco',
        amount: '4500',
        currency: 'DOP',
        dueDate: todayIso,
      },
    ]);
    expect(summary.cardDueDates).toEqual([
      {
        cardId: 'card-1',
        name: 'Visa',
        lastFour: '6506',
        dueDay: todayDayOfMonth,
      },
    ]);
    expect(summary.pendingEmails).toBe(2);
  });
});
