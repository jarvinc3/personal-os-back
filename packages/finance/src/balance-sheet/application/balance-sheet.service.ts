import { Injectable } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { decimalToString } from '../../shared/domain/mappers';
import {
  roundDecimal,
  toMoney,
  type MoneyLike,
} from '../../shared/domain/money';
import { BalanceSheetRepository } from '../infrastructure/balance-sheet.repository';

export type BalanceSheetStatus = 'COMPLETE' | 'INCOMPLETE';

export type BalanceSheetIssue = {
  code: 'MISSING_CREDIT_LIMIT';
  cardId: string;
  currency: string;
};

export type BalanceSheetSlice = {
  status: BalanceSheetStatus;
  assets: { accounts: string };
  liabilities: {
    creditCards: string | null;
    loans: string;
  };
  totalAssets: string;
  totalLiabilities: string | null;
  netWorth: string | null;
  issues: BalanceSheetIssue[];
};

export type FinanceBalanceSheet = {
  asOf: string;
  rateDate: string;
  baseCurrency: string;
  global: BalanceSheetSlice;
  institutions: Array<BalanceSheetSlice & { institutionId: string }>;
};

type Bucket = {
  accounts: Prisma.Decimal;
  creditCards: Prisma.Decimal;
  loans: Prisma.Decimal;
  issues: BalanceSheetIssue[];
};

function isMissingCreditLimit(value: MoneyLike): boolean {
  return value === null;
}

/** Debt is what the credit limit does not cover, and it never goes negative. */
function creditCardDebt(
  available: MoneyLike,
  creditLimit: MoneyLike,
): Prisma.Decimal {
  const debt = roundDecimal(toMoney(creditLimit).minus(toMoney(available)));
  return debt.isNegative() ? roundDecimal(0) : debt;
}

function emptyBucket(): Bucket {
  return {
    accounts: roundDecimal(0),
    creditCards: roundDecimal(0),
    loans: roundDecimal(0),
    issues: [],
  };
}

function serializeSlice(bucket: Bucket): BalanceSheetSlice {
  const totalAssets = roundDecimal(bucket.accounts);
  const loanDebt = roundDecimal(bucket.loans);
  const incomplete = bucket.issues.length > 0;
  const cardDebt = incomplete ? null : roundDecimal(bucket.creditCards);
  const totalLiabilities =
    incomplete || cardDebt == null
      ? null
      : roundDecimal(cardDebt.plus(loanDebt));
  const netWorth =
    totalLiabilities == null
      ? null
      : roundDecimal(totalAssets.minus(totalLiabilities));

  return {
    status: incomplete ? 'INCOMPLETE' : 'COMPLETE',
    assets: { accounts: decimalToString(totalAssets) },
    liabilities: {
      creditCards: cardDebt == null ? null : decimalToString(cardDebt),
      loans: decimalToString(loanDebt),
    },
    totalAssets: decimalToString(totalAssets),
    totalLiabilities:
      totalLiabilities == null ? null : decimalToString(totalLiabilities),
    netWorth: netWorth == null ? null : decimalToString(netWorth),
    issues: bucket.issues,
  };
}

@Injectable()
export class BalanceSheetService {
  constructor(
    private readonly repo: BalanceSheetRepository,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {}

  async getBalanceSheet(userId: string): Promise<FinanceBalanceSheet> {
    const asOf = new Date();
    const rateDate = asOf.toISOString().slice(0, 10);
    const baseCurrency = await this.baseCurrency.execute(userId);
    const { institutions, accounts, cardBalances, loans } =
      await this.repo.loadPositions(userId);

    const global = emptyBucket();
    const byInstitution = new Map<string, Bucket>();
    for (const institution of institutions) {
      byInstitution.set(institution.id, emptyBucket());
    }

    const convert = (amount: MoneyLike, currency: string) =>
      this.resolveAmounts.toBaseCurrency(amount, currency, baseCurrency, asOf);

    for (const account of accounts) {
      const amount = await convert(account.balance, account.currency);
      global.accounts = global.accounts.plus(amount);
      const bucket = account.institutionId
        ? byInstitution.get(account.institutionId)
        : undefined;
      if (bucket) {
        bucket.accounts = bucket.accounts.plus(amount);
      }
    }

    for (const row of cardBalances) {
      if (isMissingCreditLimit(row.creditLimit)) {
        const issue: BalanceSheetIssue = {
          code: 'MISSING_CREDIT_LIMIT',
          cardId: row.card.id,
          currency: row.currency,
        };
        global.issues.push(issue);
        const bucket = byInstitution.get(row.card.institutionId);
        if (bucket) {
          bucket.issues.push(issue);
        }
        continue;
      }

      const debtNative = creditCardDebt(row.balance, row.creditLimit);
      const amount = await convert(debtNative, row.currency);
      global.creditCards = global.creditCards.plus(amount);
      const bucket = byInstitution.get(row.card.institutionId);
      if (bucket) {
        bucket.creditCards = bucket.creditCards.plus(amount);
      }
    }

    for (const loan of loans) {
      const current = toMoney(loan.currentBalance);
      const owed = current.isNegative() ? roundDecimal(0) : current;
      const amount = await convert(owed, loan.currency);
      global.loans = global.loans.plus(amount);
      const bucket = loan.institutionId
        ? byInstitution.get(loan.institutionId)
        : undefined;
      if (bucket) {
        bucket.loans = bucket.loans.plus(amount);
      }
    }

    return {
      asOf: asOf.toISOString(),
      rateDate,
      baseCurrency,
      global: serializeSlice(global),
      institutions: institutions.map((institution) => ({
        institutionId: institution.id,
        ...serializeSlice(byInstitution.get(institution.id) ?? emptyBucket()),
      })),
    };
  }
}
