import { Injectable } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { FinanceEntityLookupService } from '../../entities/application/finance-entity-lookup.service';
import {
  entityRefKey,
  type FinanceEntityRef,
} from '../../entities/domain/entity-reference';
import {
  ResolveAmountsUseCase,
  type FxRateRequestCache,
} from '../../fx/application/resolve-amounts.use-case';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { monthBounds } from '../../reconciliation/domain/reconciliation-adjustment';
import { CASH_ACCOUNT_TYPE } from '../../shared/domain/cash';
import {
  decimalToString,
  decimalToNullableString,
} from '../../shared/domain/mappers';
import { localDateIso, localDayStart } from '../../shared/domain/local-day';
import {
  normalizeCurrencyCode,
  roundDecimal,
  toMoney,
  type MoneyLike,
} from '../../shared/domain/money';
import {
  BALANCE_SHEET_LINE_KIND,
  BALANCE_SHEET_RECONCILIATION,
  currencySlices,
  entityTypeForLineKind,
  groupBalanceSheetLines,
  type BalanceSheetBreakdown,
  type BalanceSheetCurrencySlice,
  type BalanceSheetLine,
} from '../domain/balance-sheet-breakdown';
import { BalanceSheetRepository } from '../infrastructure/balance-sheet.repository';

export type BalanceSheetStatus = 'COMPLETE' | 'INCOMPLETE';

export type BalanceSheetIssue =
  | {
      code: 'MISSING_CREDIT_LIMIT';
      cardId: string;
      currency: string;
    }
  | { code: 'MISSING_RATE'; currency: string };

export type CashAccountLine = {
  id: string;
  name: string;
  balance: string;
};

export type CashCurrencyBreakdown = {
  currency: string;
  total: string;
  totalBase: string | null;
  accounts: CashAccountLine[];
};

/** Cash converted to the user's base currency, with a per-currency breakdown. */
export type FinanceCashSummary = {
  totalBase: string | null;
  baseCurrency: string;
  rateDate: string;
  status: BalanceSheetStatus;
  byCurrency: CashCurrencyBreakdown[];
};

export type BalanceSheetSlice = {
  status: BalanceSheetStatus;
  assets: { accounts: string; cash: string; receivables: string };
  liabilities: {
    creditCards: string | null;
    loans: string;
  };
  totalAssets: string;
  totalLiabilities: string | null;
  netWorth: string | null;
  /** Native totals per currency; no conversion and no receivables without institution. */
  byCurrency: BalanceSheetCurrencySlice[];
  issues: BalanceSheetIssue[];
};

export type FinanceBalanceSheet = {
  asOf: string;
  rateDate: string;
  baseCurrency: string;
  global: BalanceSheetSlice;
  institutions: Array<BalanceSheetSlice & { institutionId: string }>;
  cash: FinanceCashSummary;
  breakdown: BalanceSheetBreakdown;
};

type Bucket = {
  accounts: Prisma.Decimal;
  cash: Prisma.Decimal;
  receivables: Prisma.Decimal;
  creditCards: Prisma.Decimal;
  loans: Prisma.Decimal;
  issues: BalanceSheetIssue[];
};

type ReceivableRow = {
  id: string;
  debtorName: string;
  description: string | null;
  amount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  writtenOffAmount: Prisma.Decimal;
  currency: string;
  dueDate: Date | null;
};

const DOUBTFUL_RECEIVABLE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function receivableOutstanding(row: ReceivableRow): Prisma.Decimal {
  const outstanding = roundDecimal(
    toMoney(row.amount)
      .minus(toMoney(row.paidAmount))
      .minus(toMoney(row.writtenOffAmount)),
  );
  return outstanding.isNegative() ? roundDecimal(0) : outstanding;
}

function emptyBucket(): Bucket {
  return {
    accounts: roundDecimal(0),
    cash: roundDecimal(0),
    receivables: roundDecimal(0),
    creditCards: roundDecimal(0),
    loans: roundDecimal(0),
    issues: [],
  };
}

function serializeSlice(
  bucket: Bucket,
  byCurrency: BalanceSheetCurrencySlice[],
): BalanceSheetSlice {
  // `accounts` already includes cash; `cash` is the informational subset.
  const totalAssets = roundDecimal(bucket.accounts.plus(bucket.receivables));
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
    assets: {
      accounts: decimalToString(roundDecimal(bucket.accounts)),
      cash: decimalToString(roundDecimal(bucket.cash)),
      receivables: decimalToString(roundDecimal(bucket.receivables)),
    },
    liabilities: {
      creditCards: cardDebt == null ? null : decimalToString(cardDebt),
      loans: decimalToString(loanDebt),
    },
    totalAssets: decimalToString(totalAssets),
    totalLiabilities:
      totalLiabilities == null ? null : decimalToString(totalLiabilities),
    netWorth: netWorth == null ? null : decimalToString(netWorth),
    byCurrency,
    issues: bucket.issues,
  };
}

function accountKey(accountId: string, currency: string): string {
  return `account:${accountId}:${normalizeCurrencyCode(currency)}`;
}

function cardKey(cardId: string, currency: string): string {
  return `card:${cardId}:${normalizeCurrencyCode(currency)}`;
}

function driftValue(drift: { difference: Prisma.Decimal } | undefined): {
  hasDrift: boolean;
  driftDifference: string | null;
} {
  if (!drift) {
    return { hasDrift: false, driftDifference: null };
  }
  return {
    hasDrift: true,
    driftDifference: decimalToString(drift.difference),
  };
}

function reconciliationState(
  reconciledKeys: ReadonlySet<string>,
  key: string,
): (typeof BALANCE_SHEET_RECONCILIATION)[keyof typeof BALANCE_SHEET_RECONCILIATION] {
  return reconciledKeys.has(key)
    ? BALANCE_SHEET_RECONCILIATION.RECONCILED
    : BALANCE_SHEET_RECONCILIATION.PENDING;
}

@Injectable()
export class BalanceSheetService {
  constructor(
    private readonly repo: BalanceSheetRepository,
    private readonly resolveAmounts: ResolveAmountsUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    private readonly entities: FinanceEntityLookupService,
  ) {}

  async getBalanceSheet(userId: string): Promise<FinanceBalanceSheet> {
    const asOf = new Date();
    const rateDate = asOf.toISOString().slice(0, 10);
    const baseCurrency = await this.baseCurrency.execute(userId);
    const timezone = await this.repo.loadUserTimezone(userId);
    const month = localDateIso(timezone, asOf).slice(0, 7);
    const { from, to } = monthBounds(month);
    const [positions, receivables, drifts, reconciliations] = await Promise.all(
      [
        this.repo.loadPositions(userId),
        this.repo.loadReceivables(userId),
        this.repo.loadOpenDrifts(userId),
        this.repo.loadMonthReconciliations(userId, from, to),
      ],
    );
    const { institutions, accounts, cardBalances, loans } = positions;

    const global = emptyBucket();
    const byInstitution = new Map<string, Bucket>();
    for (const institution of institutions) {
      byInstitution.set(institution.id, emptyBucket());
    }

    const reconciledKeys = new Set<string>();
    for (const reconciliation of reconciliations) {
      if (reconciliation.accountId) {
        reconciledKeys.add(
          accountKey(reconciliation.accountId, reconciliation.currency),
        );
      }
      if (reconciliation.cardId) {
        reconciledKeys.add(
          cardKey(reconciliation.cardId, reconciliation.currency),
        );
      }
    }

    const driftByAccount = new Map<string, { difference: Prisma.Decimal }>();
    const driftByCard = new Map<string, { difference: Prisma.Decimal }>();
    for (const drift of drifts) {
      if (drift.accountId) {
        driftByAccount.set(accountKey(drift.accountId, drift.currency), {
          difference: drift.difference,
        });
      }
      if (drift.cardId) {
        driftByCard.set(cardKey(drift.cardId, drift.currency), {
          difference: drift.difference,
        });
      }
    }

    const rateCache: FxRateRequestCache = new Map();
    const convert = (amount: MoneyLike, currency: string) =>
      this.resolveAmounts.toBaseCurrency(
        amount,
        currency,
        baseCurrency,
        asOf,
        rateCache,
      );
    const lines: Array<Omit<BalanceSheetLine, 'entity'>> = [];

    for (const account of accounts) {
      const currency = normalizeCurrencyCode(account.currency);
      const isCash = account.type === CASH_ACCOUNT_TYPE;
      const converted = await this.resolveAmounts.toBaseCurrencyOrNull(
        account.balance,
        currency,
        baseCurrency,
        asOf,
        rateCache,
      );
      const drift = driftValue(
        driftByAccount.get(accountKey(account.id, currency)),
      );
      lines.push({
        id: account.id,
        kind: isCash
          ? BALANCE_SHEET_LINE_KIND.CASH
          : BALANCE_SHEET_LINE_KIND.ACCOUNT,
        name: account.name ?? (isCash ? 'Efectivo' : 'Cuenta'),
        description: null,
        institutionId: account.institutionId,
        currency,
        balance: decimalToString(account.balance),
        balanceBase:
          converted === null ? null : decimalToNullableString(converted),
        hasDrift: drift.hasDrift,
        driftDifference: drift.driftDifference,
        reconciliation: reconciliationState(
          reconciledKeys,
          accountKey(account.id, currency),
        ),
        creditLimit: null,
        availableCredit: null,
        dueDate: null,
        doubtful: false,
      });

      if (converted === null) {
        global.issues.push({ code: 'MISSING_RATE', currency });
        const bucket = account.institutionId
          ? byInstitution.get(account.institutionId)
          : undefined;
        if (bucket) {
          bucket.issues.push({ code: 'MISSING_RATE', currency });
        }
        continue;
      }
      global.accounts = global.accounts.plus(converted);
      if (isCash) {
        global.cash = global.cash.plus(converted);
      }
      const bucket = account.institutionId
        ? byInstitution.get(account.institutionId)
        : undefined;
      if (bucket) {
        bucket.accounts = bucket.accounts.plus(converted);
        if (isCash) {
          bucket.cash = bucket.cash.plus(converted);
        }
      }
    }

    for (const row of cardBalances) {
      const currency = normalizeCurrencyCode(row.currency);
      const drift = driftValue(driftByCard.get(cardKey(row.card.id, currency)));
      const baseLine = {
        id: row.card.id,
        kind: BALANCE_SHEET_LINE_KIND.CREDIT_CARD,
        name: row.card.name ?? 'Tarjeta',
        description: null,
        institutionId: row.card.institutionId,
        currency,
        hasDrift: drift.hasDrift,
        driftDifference: drift.driftDifference,
        reconciliation: reconciliationState(
          reconciledKeys,
          cardKey(row.card.id, currency),
        ),
        creditLimit: decimalToNullableString(row.creditLimit),
        availableCredit: decimalToString(row.balance),
        dueDate: null,
        doubtful: false,
      };

      if (isMissingCreditLimit(row.creditLimit)) {
        const issue: BalanceSheetIssue = {
          code: 'MISSING_CREDIT_LIMIT',
          cardId: row.card.id,
          currency,
        };
        global.issues.push(issue);
        const bucket = byInstitution.get(row.card.institutionId);
        if (bucket) {
          bucket.issues.push(issue);
        }
        lines.push({
          ...baseLine,
          balance: '0',
          balanceBase: null,
        });
        continue;
      }

      const debtNative = creditCardDebt(row.balance, row.creditLimit);
      const amount = await convert(debtNative, currency);
      lines.push({
        ...baseLine,
        balance: decimalToString(debtNative),
        balanceBase: decimalToString(amount),
      });
      global.creditCards = global.creditCards.plus(amount);
      const bucket = byInstitution.get(row.card.institutionId);
      if (bucket) {
        bucket.creditCards = bucket.creditCards.plus(amount);
      }
    }

    for (const loan of loans) {
      const currency = normalizeCurrencyCode(loan.currency);
      const current = toMoney(loan.currentBalance);
      const owed = current.isNegative() ? roundDecimal(0) : current;
      const amount = await convert(owed, currency);
      lines.push({
        id: loan.id,
        kind: BALANCE_SHEET_LINE_KIND.LOAN,
        name: loan.lenderName ?? 'Préstamo',
        description: null,
        institutionId: loan.institutionId,
        currency,
        balance: decimalToString(owed),
        balanceBase: decimalToString(amount),
        hasDrift: false,
        driftDifference: null,
        reconciliation: BALANCE_SHEET_RECONCILIATION.NOT_APPLICABLE,
        creditLimit: null,
        availableCredit: null,
        dueDate: null,
        doubtful: false,
      });
      global.loans = global.loans.plus(amount);
      const bucket = loan.institutionId
        ? byInstitution.get(loan.institutionId)
        : undefined;
      if (bucket) {
        bucket.loans = bucket.loans.plus(amount);
      }
    }

    const today = localDayStart(timezone, asOf);
    const doubtfulCutoff = new Date(
      today.getTime() - DOUBTFUL_RECEIVABLE_DAYS * DAY_MS,
    );
    for (const receivable of receivables) {
      const outstanding = receivableOutstanding(receivable);
      if (outstanding.isZero()) {
        continue;
      }
      const currency = normalizeCurrencyCode(receivable.currency);
      const doubtful =
        receivable.dueDate !== null && receivable.dueDate < doubtfulCutoff;
      const converted = await this.resolveAmounts.toBaseCurrencyOrNull(
        outstanding,
        currency,
        baseCurrency,
        asOf,
        rateCache,
      );
      if (converted === null && !doubtful) {
        global.issues.push({ code: 'MISSING_RATE', currency });
      }
      if (converted !== null && !doubtful) {
        global.receivables = global.receivables.plus(converted);
      }
      lines.push({
        id: receivable.id,
        kind: BALANCE_SHEET_LINE_KIND.RECEIVABLE,
        name: receivable.debtorName,
        description: receivable.description,
        institutionId: null,
        currency,
        balance: decimalToString(outstanding),
        balanceBase:
          converted === null ? null : decimalToNullableString(converted),
        hasDrift: false,
        driftDifference: null,
        reconciliation: BALANCE_SHEET_RECONCILIATION.NOT_APPLICABLE,
        creditLimit: null,
        availableCredit: null,
        dueDate: receivable.dueDate
          ? receivable.dueDate.toISOString().slice(0, 10)
          : null,
        doubtful,
      });
    }

    const entityRefs = lines.map((line): FinanceEntityRef => ({
      type: entityTypeForLineKind(line.kind),
      id: line.id,
    }));
    const entities =
      entityRefs.length > 0
        ? await this.entities.lookupByKey(userId, entityRefs)
        : new Map<string, unknown>();
    const linesWithEntities: BalanceSheetLine[] = lines.map((line, index) => ({
      ...line,
      entity: entities.get(entityRefKey(entityRefs[index])) ?? null,
    }));

    const breakdown = groupBalanceSheetLines(linesWithEntities, baseCurrency);
    const linesByInstitution = new Map<string, BalanceSheetLine[]>();
    for (const line of linesWithEntities) {
      if (!line.institutionId) {
        continue;
      }
      const group = linesByInstitution.get(line.institutionId) ?? [];
      group.push(line);
      linesByInstitution.set(line.institutionId, group);
    }

    return {
      asOf: asOf.toISOString(),
      rateDate,
      baseCurrency,
      global: serializeSlice(global, currencySlices(breakdown.byCurrency)),
      institutions: institutions.map((institution) => {
        const institutionBreakdown = groupBalanceSheetLines(
          linesByInstitution.get(institution.id) ?? [],
          baseCurrency,
        );
        return {
          institutionId: institution.id,
          ...serializeSlice(
            byInstitution.get(institution.id) ?? emptyBucket(),
            currencySlices(institutionBreakdown.byCurrency),
          ),
        };
      }),
      cash: await this.buildCashSummary(userId, baseCurrency, asOf, rateCache),
      breakdown,
    };
  }

  private async buildCashSummary(
    userId: string,
    baseCurrency: string,
    asOf: Date,
    rateCache: FxRateRequestCache,
  ): Promise<FinanceCashSummary> {
    const accounts = await this.repo.loadCashAccounts(userId);
    const grouped = new Map<
      string,
      { total: Prisma.Decimal; accounts: CashAccountLine[] }
    >();
    for (const account of accounts) {
      const currency = normalizeCurrencyCode(account.currency);
      const group = grouped.get(currency) ?? {
        total: roundDecimal(0),
        accounts: [],
      };
      group.total = roundDecimal(group.total.plus(account.balance));
      group.accounts.push({
        id: account.id,
        name: account.name,
        balance: decimalToString(account.balance),
      });
      grouped.set(currency, group);
    }

    const byCurrency: CashCurrencyBreakdown[] = [];
    let totalBase = roundDecimal(0);
    let incomplete = false;
    for (const [currency, group] of grouped) {
      const converted = await this.resolveAmounts.toBaseCurrencyOrNull(
        group.total,
        currency,
        baseCurrency,
        asOf,
        rateCache,
      );
      if (converted === null) {
        incomplete = true;
      } else {
        totalBase = roundDecimal(totalBase.plus(converted));
      }
      byCurrency.push({
        currency,
        total: decimalToString(group.total),
        totalBase: converted === null ? null : decimalToString(converted),
        accounts: group.accounts,
      });
    }

    return {
      totalBase: incomplete ? null : decimalToString(totalBase),
      baseCurrency,
      rateDate: asOf.toISOString().slice(0, 10),
      status: incomplete ? 'INCOMPLETE' : 'COMPLETE',
      byCurrency,
    };
  }
}
