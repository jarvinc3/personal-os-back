import type { StatementMovement } from './card-statement-amounts';
import {
  buildCardStatementViews,
  cardStatementStatus,
} from './card-statement-views';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

function snapshot(overrides: {
  id: string;
  currency?: string;
  cycleStart: Date;
  cycleEnd: Date;
  dueDate: Date | null;
  closingBalance: number;
}) {
  return {
    currency: 'DOP',
    minimumPayment: null,
    minimumSource: null,
    ...overrides,
  };
}

function movement(
  overrides: Partial<StatementMovement> & Pick<StatementMovement, 'type'>,
): StatementMovement {
  return {
    status: 'CONFIRMED',
    ledgerAmount: 100,
    ledgerCurrency: 'DOP',
    transactionDate: utc(2026, 1, 10),
    ...overrides,
  };
}

describe('card-statement-views', () => {
  it('derives every statement status', () => {
    const base = {
      cycleEnd: utc(2026, 1, 15),
      dueDate: utc(2026, 2, 5),
      closingBalance: 6400,
      minimumPayment: 177.78,
      today: utc(2026, 1, 20),
    };
    expect(cardStatementStatus({ ...base, paidAmount: 0 })).toBe('CLOSED');
    expect(cardStatementStatus({ ...base, paidAmount: 100 })).toBe('PARTIAL');
    expect(cardStatementStatus({ ...base, paidAmount: 177.78 })).toBe(
      'MINIMUM_PAID',
    );
    expect(cardStatementStatus({ ...base, paidAmount: 6400 })).toBe('PAID');
    expect(
      cardStatementStatus({ ...base, today: utc(2026, 2, 10), paidAmount: 0 }),
    ).toBe('OVERDUE');
    expect(
      cardStatementStatus({
        ...base,
        cycleEnd: utc(2026, 2, 15),
        paidAmount: 0,
      }),
    ).toBe('OPEN');
  });

  it('scopes payments to the due date', () => {
    const views = buildCardStatementViews({
      statements: [
        snapshot({
          id: 'jan',
          cycleStart: utc(2025, 12, 15),
          cycleEnd: utc(2026, 1, 15),
          dueDate: utc(2026, 2, 5),
          closingBalance: 6400,
        }),
        snapshot({
          id: 'feb',
          cycleStart: utc(2026, 1, 15),
          cycleEnd: utc(2026, 2, 15),
          dueDate: utc(2026, 3, 5),
          closingBalance: 5200,
        }),
      ],
      movements: [
        movement({
          type: 'CREDIT',
          ledgerAmount: 5000,
          transactionDate: utc(2026, 1, 20),
        }),
        movement({
          type: 'CREDIT',
          ledgerAmount: 1400,
          transactionDate: utc(2026, 1, 28),
        }),
        movement({
          type: 'CREDIT',
          ledgerAmount: 900,
          transactionDate: utc(2026, 2, 20),
        }),
      ],
      today: utc(2026, 3, 1),
    });

    expect(views[0]).toMatchObject({
      paidAmount: 6400,
      remaining: 0,
      status: 'PAID',
    });
    expect(views[1]).toMatchObject({
      paidAmount: 900,
      remaining: 4300,
      status: 'MINIMUM_PAID',
    });
  });

  it('keeps currencies apart', () => {
    const views = buildCardStatementViews({
      statements: [
        snapshot({
          id: 'dop',
          cycleStart: utc(2026, 1, 15),
          cycleEnd: utc(2026, 2, 15),
          dueDate: null,
          closingBalance: 1000,
        }),
        snapshot({
          id: 'usd',
          currency: 'USD',
          cycleStart: utc(2026, 1, 15),
          cycleEnd: utc(2026, 2, 15),
          dueDate: null,
          closingBalance: 300,
        }),
      ],
      movements: [
        movement({
          type: 'CREDIT',
          ledgerAmount: 1000,
          ledgerCurrency: 'USD',
          transactionDate: utc(2026, 2, 20),
        }),
      ],
      today: utc(2026, 3, 1),
    });

    expect(views[0]).toMatchObject({ paidAmount: 0, status: 'CLOSED' });
    expect(views[1]).toMatchObject({ paidAmount: 1000, status: 'PAID' });
  });

  it('estimates the minimum when the statement has none', () => {
    const views = buildCardStatementViews({
      statements: [
        snapshot({
          id: 'latest',
          cycleStart: utc(2026, 1, 15),
          cycleEnd: utc(2026, 2, 15),
          dueDate: utc(2026, 3, 5),
          closingBalance: 3600,
        }),
      ],
      movements: [],
      today: utc(2026, 3, 1),
    });

    expect(views[0]).toMatchObject({
      minimumPayment: 100,
      minimumSource: 'ESTIMATED',
      paidAmount: 0,
      status: 'CLOSED',
    });
  });
});
