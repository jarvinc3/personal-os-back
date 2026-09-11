import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../../config';
import { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { decimalToString } from '../../shared/domain/mappers';
import { roundMoney } from '../../shared/domain/money';
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

type Moneyish = { toString(): string } | number | null | undefined;

type Bucket = {
  accounts: number;
  creditCards: number;
  loans: number;
  issues: BalanceSheetIssue[];
};

function toNumber(value: Moneyish): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMissingCreditLimit(value: Moneyish): boolean {
  return value == null;
}

function creditCardDebt(available: number, creditLimit: number): number {
  return Math.max(0, roundMoney(creditLimit - available));
}

function emptyBucket(): Bucket {
  return { accounts: 0, creditCards: 0, loans: 0, issues: [] };
}

function serializeSlice(bucket: Bucket): BalanceSheetSlice {
  const totalAssets = roundMoney(bucket.accounts);
  const loanDebt = roundMoney(bucket.loans);
  const incomplete = bucket.issues.length > 0;
  const cardDebt = incomplete ? null : roundMoney(bucket.creditCards);
  const totalLiabilities =
    incomplete || cardDebt == null ? null : roundMoney(cardDebt + loanDebt);
  const netWorth =
    totalLiabilities == null
      ? null
      : roundMoney(totalAssets - totalLiabilities);

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
    private readonly config: ConfigService<Env, true>,
  ) {}

  async getBalanceSheet(userId: string): Promise<FinanceBalanceSheet> {
    const asOf = new Date();
    const rateDate = asOf.toISOString().slice(0, 10);
    const baseCurrency = this.config.get('BASE_CURRENCY', { infer: true });
    const { institutions, accounts, cardBalances, loans } =
      await this.repo.loadPositions(userId);

    const global = emptyBucket();
    const byInstitution = new Map<string, Bucket>();
    for (const institution of institutions) {
      byInstitution.set(institution.id, emptyBucket());
    }

    const convert = (amount: number, currency: string) =>
      this.resolveAmounts.toBaseCurrency(amount, currency, asOf);

    for (const account of accounts) {
      const amount = await convert(toNumber(account.balance), account.currency);
      global.accounts += amount;
      const bucket = account.institutionId
        ? byInstitution.get(account.institutionId)
        : undefined;
      if (bucket) bucket.accounts += amount;
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
        if (bucket) bucket.issues.push(issue);
        continue;
      }

      const debtNative = creditCardDebt(
        toNumber(row.balance),
        toNumber(row.creditLimit),
      );
      const amount = await convert(debtNative, row.currency);
      global.creditCards += amount;
      const bucket = byInstitution.get(row.card.institutionId);
      if (bucket) bucket.creditCards += amount;
    }

    for (const loan of loans) {
      const amount = await convert(
        Math.max(0, toNumber(loan.currentBalance)),
        loan.currency,
      );
      global.loans += amount;
      const bucket = loan.institutionId
        ? byInstitution.get(loan.institutionId)
        : undefined;
      if (bucket) bucket.loans += amount;
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
