import type { StatementMovement } from './card-statement-amounts';
import {
  buildCardStatementViews,
  cardStatementStatus,
} from './card-statement-views';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

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
  it('cardStatementStatus derives pending, partial and paid', () => {
    expect(cardStatementStatus({ closingBalance: 6400, amountPaid: 0 })).toBe(
      'PENDING',
    );
    expect(
      cardStatementStatus({ closingBalance: 6400, amountPaid: 1600 }),
    ).toBe('PARTIAL');
    expect(
      cardStatementStatus({ closingBalance: 6400, amountPaid: 6400 }),
    ).toBe('PAID');
    expect(cardStatementStatus({ closingBalance: 0, amountPaid: 0 })).toBe(
      'PAID',
    );
  });

  it('scopes payments to the following cycle', () => {
    const views = buildCardStatementViews({
      statements: [
        {
          id: 'jan',
          currency: 'DOP',
          cycleStart: utc(2025, 12, 15),
          cycleEnd: utc(2026, 1, 15),
          dueDate: utc(2026, 2, 5),
          closingBalance: 6400,
        },
        {
          id: 'feb',
          currency: 'DOP',
          cycleStart: utc(2026, 1, 15),
          cycleEnd: utc(2026, 2, 15),
          dueDate: utc(2026, 3, 5),
          closingBalance: 5200,
        },
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
      amountPaid: 6400,
      remaining: 0,
      status: 'PAID',
    });
    expect(views[1]).toMatchObject({
      amountPaid: 900,
      remaining: 4300,
      status: 'PARTIAL',
    });
  });

  it('keeps currencies apart', () => {
    const views = buildCardStatementViews({
      statements: [
        {
          id: 'dop',
          currency: 'DOP',
          cycleStart: utc(2026, 1, 15),
          cycleEnd: utc(2026, 2, 15),
          dueDate: null,
          closingBalance: 1000,
        },
        {
          id: 'usd',
          currency: 'USD',
          cycleStart: utc(2026, 1, 15),
          cycleEnd: utc(2026, 2, 15),
          dueDate: null,
          closingBalance: 300,
        },
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

    expect(views[0]).toMatchObject({ amountPaid: 0, status: 'PENDING' });
    expect(views[1]).toMatchObject({ amountPaid: 1000, status: 'PAID' });
  });

  it('uses today for the newest statement', () => {
    const views = buildCardStatementViews({
      statements: [
        {
          id: 'latest',
          currency: 'DOP',
          cycleStart: utc(2026, 1, 15),
          cycleEnd: utc(2026, 2, 15),
          dueDate: utc(2026, 3, 5),
          closingBalance: 1000,
        },
      ],
      movements: [
        movement({
          type: 'CREDIT',
          ledgerAmount: 400,
          transactionDate: utc(2026, 2, 20),
        }),
        movement({
          type: 'CREDIT',
          ledgerAmount: 300,
          transactionDate: utc(2026, 2, 25),
        }),
      ],
      today: utc(2026, 3, 1),
    });

    expect(views[0]).toMatchObject({ amountPaid: 700, status: 'PARTIAL' });
  });
});
