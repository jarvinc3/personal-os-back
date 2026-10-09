import {
  availableCreditDelta,
  debtAtClosing,
  paymentsInWindow,
  statementLedgerDelta,
  type StatementMovement,
} from './card-statement-amounts';

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

describe('card-statement-amounts', () => {
  it('statementLedgerDelta mirrors the ledger sign convention', () => {
    expect(statementLedgerDelta(movement({ type: 'CREDIT' }))).toBe(100);
    expect(statementLedgerDelta(movement({ type: 'DEBIT' }))).toBe(-100);
    expect(statementLedgerDelta(movement({ type: 'TRANSFER' }))).toBe(0);
  });

  it('availableCreditDelta sums confirmed deltas inside the window only', () => {
    const movements = [
      movement({
        type: 'CREDIT',
        ledgerAmount: 500,
        transactionDate: utc(2026, 1, 5),
      }),
      movement({
        type: 'DEBIT',
        ledgerAmount: 200,
        transactionDate: utc(2026, 1, 14),
      }),
      movement({
        type: 'CREDIT',
        ledgerAmount: 900,
        transactionDate: utc(2026, 1, 16),
      }),
    ];

    expect(
      availableCreditDelta(movements, utc(2026, 1, 10), utc(2026, 1, 15)),
    ).toBe(-200);
  });

  it('availableCreditDelta ignores movements that are not confirmed', () => {
    const movements = [
      movement({ type: 'CREDIT', ledgerAmount: 500 }),
      movement({ type: 'CREDIT', ledgerAmount: 300, status: 'PENDING' }),
      movement({ type: 'DEBIT', ledgerAmount: 100, status: 'DECLINED' }),
    ];

    expect(
      availableCreditDelta(movements, utc(2026, 1, 1), utc(2026, 1, 31)),
    ).toBe(500);
  });

  it('debtAtClosing derives the closing debt from the available credit', () => {
    const movements = [
      movement({
        type: 'DEBIT',
        ledgerAmount: 1000,
        transactionDate: utc(2026, 2, 20),
      }),
      movement({
        type: 'CREDIT',
        ledgerAmount: 500,
        transactionDate: utc(2026, 2, 25),
      }),
    ];

    expect(
      debtAtClosing({
        currentAvailable: 145800,
        creditLimit: 150000,
        movements,
        closingDate: utc(2026, 2, 15),
        today: utc(2026, 3, 1),
      }),
    ).toBe(3700);
  });

  it('debtAtClosing never returns a negative debt', () => {
    expect(
      debtAtClosing({
        currentAvailable: 150000,
        creditLimit: 150000,
        movements: [],
        closingDate: utc(2026, 2, 15),
        today: utc(2026, 3, 1),
      }),
    ).toBe(0);
  });

  it('paymentsInWindow counts only payments inside the window', () => {
    const movements = [
      movement({
        type: 'DEBIT',
        ledgerAmount: 400,
        transactionDate: utc(2026, 1, 20),
      }),
      movement({
        type: 'CREDIT',
        ledgerAmount: 1000,
        transactionDate: utc(2026, 1, 25),
      }),
      movement({
        type: 'CREDIT',
        ledgerAmount: 250,
        transactionDate: utc(2026, 2, 1),
      }),
      movement({
        type: 'CREDIT',
        ledgerAmount: 500,
        transactionDate: utc(2026, 2, 16),
      }),
    ];

    expect(
      paymentsInWindow(movements, utc(2026, 1, 15), utc(2026, 2, 15)),
    ).toBe(1250);
  });
});
