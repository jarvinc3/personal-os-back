import {
  buildClosedCardCycles,
  firstDueDateAfter,
  isStatementDay,
  shiftStatementMonths,
  startOfUtcDay,
  statementDateOfMonth,
  statementDateOnOrAfter,
} from './card-statement-cycle';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

describe('card-statement-cycle', () => {
  it('isStatementDay accepts 1..31 only', () => {
    expect(isStatementDay(1)).toBe(true);
    expect(isStatementDay(31)).toBe(true);
    expect(isStatementDay(0)).toBe(false);
    expect(isStatementDay(32)).toBe(false);
    expect(isStatementDay(null)).toBe(false);
    expect(isStatementDay(15.5)).toBe(false);
  });

  it('startOfUtcDay truncates the time of day', () => {
    expect(startOfUtcDay(new Date('2026-03-15T23:45:10.123Z'))).toEqual(
      utc(2026, 3, 15),
    );
  });

  it('statementDateOfMonth clamps to the last day of the month', () => {
    expect(statementDateOfMonth(2026, 2, 31)).toEqual(utc(2026, 2, 28));
    expect(statementDateOfMonth(2024, 2, 31)).toEqual(utc(2024, 2, 29));
    expect(statementDateOfMonth(2026, 4, 31)).toEqual(utc(2026, 4, 30));
  });

  it('shiftStatementMonths keeps the clamped day across months', () => {
    expect(shiftStatementMonths(utc(2026, 1, 31), 31, 1)).toEqual(
      utc(2026, 2, 28),
    );
    expect(shiftStatementMonths(utc(2026, 2, 28), 31, 1)).toEqual(
      utc(2026, 3, 31),
    );
    expect(shiftStatementMonths(utc(2026, 1, 15), 15, -1)).toEqual(
      utc(2025, 12, 15),
    );
  });

  it('statementDateOnOrAfter moves to next month when the day already passed', () => {
    expect(statementDateOnOrAfter(15, utc(2026, 3, 10))).toEqual(
      utc(2026, 3, 15),
    );
    expect(statementDateOnOrAfter(15, utc(2026, 3, 15))).toEqual(
      utc(2026, 3, 15),
    );
    expect(statementDateOnOrAfter(15, utc(2026, 3, 20))).toEqual(
      utc(2026, 4, 15),
    );
  });

  it('firstDueDateAfter returns the first due day after closing', () => {
    expect(firstDueDateAfter(utc(2026, 3, 19), 4)).toEqual(utc(2026, 4, 4));
    expect(firstDueDateAfter(utc(2026, 3, 5), 20)).toEqual(utc(2026, 3, 20));
    expect(firstDueDateAfter(utc(2026, 1, 31), 31)).toEqual(utc(2026, 2, 28));
  });

  it('buildClosedCardCycles lists closed cycles oldest first', () => {
    const cycles = buildClosedCardCycles({
      closingDay: 15,
      firstActivityDate: utc(2026, 1, 3),
      today: utc(2026, 4, 20),
    });

    expect(cycles).toEqual([
      {
        cycleStart: utc(2025, 12, 15),
        cycleEnd: utc(2026, 1, 15),
      },
      {
        cycleStart: utc(2026, 1, 15),
        cycleEnd: utc(2026, 2, 15),
      },
      {
        cycleStart: utc(2026, 2, 15),
        cycleEnd: utc(2026, 3, 15),
      },
      {
        cycleStart: utc(2026, 3, 15),
        cycleEnd: utc(2026, 4, 15),
      },
    ]);
  });

  it('buildClosedCardCycles skips the cycle closing today', () => {
    const cycles = buildClosedCardCycles({
      closingDay: 20,
      firstActivityDate: utc(2026, 1, 1),
      today: utc(2026, 3, 20),
    });

    expect(cycles.map((cycle) => cycle.cycleEnd)).toEqual([
      utc(2026, 1, 20),
      utc(2026, 2, 20),
    ]);
  });

  it('buildClosedCardCycles returns nothing before the first closing', () => {
    const cycles = buildClosedCardCycles({
      closingDay: 25,
      firstActivityDate: utc(2026, 3, 26),
      today: utc(2026, 4, 10),
    });

    expect(cycles).toEqual([]);
  });
});
