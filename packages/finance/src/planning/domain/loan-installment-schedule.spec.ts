import {
  buildFrenchSchedule,
  buildLoanSchedule,
  frenchInstallmentAmount,
  remainingInstallmentsFor,
  shiftLoanDueDate,
} from './loan-installment-schedule';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

describe('loan-installment-schedule', () => {
  it('shiftLoanDueDate steps by frequency', () => {
    expect(shiftLoanDueDate(utc(2026, 1, 10), 'WEEKLY', 1)).toEqual(
      utc(2026, 1, 17),
    );
    expect(shiftLoanDueDate(utc(2026, 1, 10), 'BIWEEKLY', 2)).toEqual(
      utc(2026, 2, 7),
    );
    expect(shiftLoanDueDate(utc(2026, 1, 31), 'MONTHLY', 1)).toEqual(
      utc(2026, 2, 28),
    );
    expect(shiftLoanDueDate(utc(2026, 3, 10), 'MONTHLY', -2)).toEqual(
      utc(2026, 1, 10),
    );
  });

  it('buildLoanSchedule grows forward from the first instalment', () => {
    const schedule = buildLoanSchedule({
      anchorDueDate: utc(2026, 2, 5),
      anchorInstallmentNo: 1,
      installmentFreq: 'MONTHLY',
      totalInstallments: 3,
      installmentAmount: 1500,
    });

    expect(schedule).toEqual([
      { installmentNo: 1, dueDate: utc(2026, 2, 5), amount: 1500 },
      { installmentNo: 2, dueDate: utc(2026, 3, 5), amount: 1500 },
      { installmentNo: 3, dueDate: utc(2026, 4, 5), amount: 1500 },
    ]);
  });

  it('buildLoanSchedule walks backwards from an anchor already in progress', () => {
    const schedule = buildLoanSchedule({
      anchorDueDate: utc(2026, 6, 1),
      anchorInstallmentNo: 4,
      installmentFreq: 'BIWEEKLY',
      totalInstallments: 6,
      installmentAmount: 800,
    });

    expect(schedule.map((row) => row.dueDate)).toEqual([
      utc(2026, 4, 20),
      utc(2026, 5, 4),
      utc(2026, 5, 18),
      utc(2026, 6, 1),
      utc(2026, 6, 15),
      utc(2026, 6, 29),
    ]);
  });

  it('buildLoanSchedule rejects an anchor outside the schedule', () => {
    expect(() =>
      buildLoanSchedule({
        anchorDueDate: utc(2026, 2, 5),
        anchorInstallmentNo: 4,
        installmentFreq: 'MONTHLY',
        totalInstallments: 3,
        installmentAmount: 1500,
      }),
    ).toThrow('anchorInstallmentNo must be within 1..3');
  });

  it('buildLoanSchedule rejects a non-positive total', () => {
    expect(() =>
      buildLoanSchedule({
        anchorDueDate: utc(2026, 2, 5),
        anchorInstallmentNo: 1,
        installmentFreq: 'MONTHLY',
        totalInstallments: 0,
        installmentAmount: 1500,
      }),
    ).toThrow('totalInstallments must be >= 1');
  });

  it('computes the French payment for a fixed case', () => {
    expect(
      frenchInstallmentAmount({
        principal: 100000,
        annualInterestRate: 0.18,
        installmentFreq: 'MONTHLY',
        totalInstallments: 12,
      }),
    ).toBe(9168);
  });

  it('splits the first instalment into interest and principal', () => {
    const schedule = buildFrenchSchedule({
      anchorDueDate: utc(2026, 2, 5),
      anchorInstallmentNo: 1,
      installmentFreq: 'MONTHLY',
      totalInstallments: 12,
      originalPrincipal: 100000,
      outstandingPrincipal: 100000,
      annualInterestRate: 0.18,
      installmentAmount: 9168,
      insuranceAmount: 0,
    });

    expect(schedule).toHaveLength(12);
    expect(schedule[0]).toMatchObject({ interest: 1500, principal: 7668 });
    expect(schedule[11]?.principal).toBeGreaterThan(0);
  });

  it('counts the periods left for a fixed instalment', () => {
    expect(
      remainingInstallmentsFor({
        balance: 100000,
        installmentAmount: 9168,
        annualInterestRate: 0.18,
        installmentFreq: 'MONTHLY',
      }),
    ).toBe(12);
    expect(
      remainingInstallmentsFor({
        balance: 50000,
        installmentAmount: 9168,
        annualInterestRate: 0.18,
        installmentFreq: 'MONTHLY',
      }),
    ).toBeLessThan(12);
  });
});
