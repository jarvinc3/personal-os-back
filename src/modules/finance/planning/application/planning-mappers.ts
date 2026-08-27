import {
  decimalToNullableString,
  decimalToString,
} from '../../shared/domain/mappers';

type Decimalish = { toString(): string } | number | string | null | undefined;

export function mapBudget<
  T extends {
    amountLimit: Decimalish;
    amountSpent: Decimalish;
    alertThresholdPct: Decimalish;
  },
>(row: T) {
  return {
    ...row,
    amountLimit: decimalToString(row.amountLimit),
    amountSpent: decimalToString(row.amountSpent),
    alertThresholdPct: Number(row.alertThresholdPct),
  };
}

export function mapSavingsGoal<
  T extends {
    targetAmount: Decimalish;
    currentAmount: Decimalish;
  },
>(row: T) {
  return {
    ...row,
    targetAmount: decimalToString(row.targetAmount),
    currentAmount: decimalToString(row.currentAmount),
  };
}

export function mapLoan<
  T extends {
    originalAmount: Decimalish;
    currentBalance: Decimalish;
    installmentAmount: Decimalish;
    interestRate: Decimalish;
  },
>(row: T) {
  return {
    ...row,
    originalAmount: decimalToString(row.originalAmount),
    currentBalance: decimalToString(row.currentBalance),
    installmentAmount: decimalToString(row.installmentAmount),
    interestRate: decimalToNullableString(row.interestRate),
  };
}

export function mapReceivable<
  T extends {
    amount: Decimalish;
    paidAmount: Decimalish;
  },
>(row: T) {
  return {
    ...row,
    amount: decimalToString(row.amount),
    paidAmount: decimalToString(row.paidAmount),
  };
}
