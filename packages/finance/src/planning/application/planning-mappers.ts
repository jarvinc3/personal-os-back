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
    carriedOver?: Decimalish;
    categories?: Array<{
      categoryId: string;
      category: { name: string; color: string | null; icon: string | null };
    }>;
  },
>(row: T) {
  const carriedOver =
    row.carriedOver === undefined ? 0 : Number(row.carriedOver);
  return {
    ...row,
    amountLimit: decimalToString(row.amountLimit),
    amountSpent: decimalToString(row.amountSpent),
    alertThresholdPct: Number(row.alertThresholdPct),
    ...(row.carriedOver !== undefined
      ? {
          carriedOver: decimalToString(carriedOver),
          effectiveLimit: decimalToString(
            Number(row.amountLimit) + carriedOver,
          ),
        }
      : {}),
    ...(row.categories
      ? {
          categories: row.categories.map((entry) => ({
            id: entry.categoryId,
            name: entry.category.name,
            color: entry.category.color,
            icon: entry.category.icon,
          })),
        }
      : {}),
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

export function mapLoanInstallment<
  T extends {
    amount: Decimalish;
    principal: Decimalish;
    interest: Decimalish;
    insurance: Decimalish;
    fees: Decimalish;
    lateFee: Decimalish;
    paidAmount: Decimalish;
  },
>(row: T) {
  return {
    ...row,
    amount: decimalToString(row.amount),
    principal: decimalToString(row.principal),
    interest: decimalToString(row.interest),
    insurance: decimalToString(row.insurance),
    fees: decimalToString(row.fees),
    lateFee: decimalToString(row.lateFee),
    paidAmount: decimalToString(row.paidAmount),
  };
}

export function mapSavingsGoalContribution<
  T extends {
    amount: Decimalish;
  },
>(row: T) {
  return {
    ...row,
    amount: decimalToString(row.amount),
  };
}

export function mapReceivablePayment<
  T extends {
    amount: Decimalish;
  },
>(row: T) {
  return {
    ...row,
    amount: decimalToString(row.amount),
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
