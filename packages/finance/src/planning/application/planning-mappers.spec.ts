import {
  mapBudget,
  mapLoan,
  mapLoanInstallment,
  mapReceivable,
  mapSavingsGoal,
} from './planning-mappers';

describe('planning money mappers', () => {
  it('maps budget money to strings and threshold to number', () => {
    expect(
      mapBudget({
        amountLimit: 1000,
        amountSpent: 10.5,
        alertThresholdPct: 80,
      }),
    ).toEqual({
      amountLimit: '1000',
      amountSpent: '10.5',
      alertThresholdPct: 80,
    });
  });

  it('keeps interestRate null distinct from zero', () => {
    expect(
      mapLoan({
        originalAmount: 100,
        currentBalance: 100,
        installmentAmount: 10,
        interestRate: null,
      }).interestRate,
    ).toBeNull();
    expect(
      mapLoan({
        originalAmount: 100,
        currentBalance: 100,
        installmentAmount: 10,
        interestRate: 0,
      }).interestRate,
    ).toBe('0');
  });

  it('maps every installment money field to a decimal string', () => {
    const decimal = (value: string) => ({ toString: () => value });

    expect(
      mapLoanInstallment({
        amount: decimal('1134.72'),
        principal: decimal('894.72'),
        interest: decimal('240'),
        insurance: 0,
        fees: 0,
        lateFee: 0,
        paidAmount: 0,
      }),
    ).toEqual({
      amount: '1134.72',
      principal: '894.72',
      interest: '240',
      insurance: '0',
      fees: '0',
      lateFee: '0',
      paidAmount: '0',
    });
  });

  it('maps savings goal and receivable money to strings', () => {
    expect(mapSavingsGoal({ targetAmount: 500, currentAmount: 20 })).toEqual({
      targetAmount: '500',
      currentAmount: '20',
    });
    expect(mapReceivable({ amount: 80, paidAmount: 0 })).toEqual({
      amount: '80',
      paidAmount: '0',
    });
  });
});
