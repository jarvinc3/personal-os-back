import type { Prisma } from '@personal-os/database';
import { CASH_ACCOUNT_TYPE } from '../../shared/domain/cash';
import {
  decimalToString,
  decimalToNullableString,
} from '../../shared/domain/mappers';
import {
  normalizeCurrencyCode,
  roundDecimal,
  toMoney,
  type MoneyLike,
} from '../../shared/domain/money';
import {
  BALANCE_SHEET_LINE_KIND,
  BALANCE_SHEET_RECONCILIATION,
  type BalanceSheetLine,
} from '../domain/balance-sheet-breakdown';
import {
  emptyBucket,
  type BalanceSheetAccumulation,
} from './balance-sheet-buckets';
import {
  accountKey,
  cardKey,
  type BalanceSheetSnapshot,
} from './balance-sheet-snapshot';
import type { BalanceSheetIssue } from './balance-sheet-types';

type BalanceSheetLineDraft = Omit<BalanceSheetLine, 'entity'>;

type LineContext = {
  snapshot: BalanceSheetSnapshot;
  accumulation: BalanceSheetAccumulation;
  lines: BalanceSheetLineDraft[];
};

/** Cuentas y efectivo: cada línea suma al global y a su institución. */
export async function addAccountLines({
  snapshot,
  accumulation,
  lines,
}: LineContext): Promise<void> {
  for (const account of snapshot.positions.accounts) {
    const currency = normalizeCurrencyCode(account.currency);
    const isCash = account.type === CASH_ACCOUNT_TYPE;
    const converted = await snapshot.convertOrNull(account.balance, currency);
    const drift = driftValue(
      snapshot.driftByAccount.get(accountKey(account.id, currency)),
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
        snapshot.reconciledKeys,
        accountKey(account.id, currency),
      ),
      creditLimit: null,
      availableCredit: null,
      dueDate: null,
      doubtful: false,
    });

    const institutionBucket = account.institutionId
      ? accumulation.byInstitution.get(account.institutionId)
      : undefined;
    if (converted === null) {
      accumulation.global.issues.push({ code: 'MISSING_RATE', currency });
      if (institutionBucket) {
        institutionBucket.issues.push({ code: 'MISSING_RATE', currency });
      }
      continue;
    }
    applyAccountTotals({
      accumulation,
      bucket: institutionBucket,
      converted,
      isCash,
    });
  }
}

function applyAccountTotals({
  accumulation,
  bucket,
  converted,
  isCash,
}: {
  accumulation: BalanceSheetAccumulation;
  bucket: ReturnType<BalanceSheetAccumulation['byInstitution']['get']>;
  converted: Prisma.Decimal;
  isCash: boolean;
}): void {
  accumulation.global.accounts = accumulation.global.accounts.plus(converted);
  if (isCash) {
    accumulation.global.cash = accumulation.global.cash.plus(converted);
  }
  if (!bucket) {
    return;
  }
  bucket.accounts = bucket.accounts.plus(converted);
  if (isCash) {
    bucket.cash = bucket.cash.plus(converted);
  }
}

/** Tarjetas de crédito: la deuda es lo que su límite no cubre. */
export async function addCardLines({
  snapshot,
  accumulation,
  lines,
}: LineContext): Promise<void> {
  for (const row of snapshot.positions.cardBalances) {
    const currency = normalizeCurrencyCode(row.currency);
    const drift = driftValue(
      snapshot.driftByCard.get(cardKey(row.card.id, currency)),
    );
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
        snapshot.reconciledKeys,
        cardKey(row.card.id, currency),
      ),
      creditLimit: decimalToNullableString(row.creditLimit),
      availableCredit: decimalToString(row.balance),
      dueDate: null,
      doubtful: false,
    };

    if (row.creditLimit === null) {
      const issue: BalanceSheetIssue = {
        code: 'MISSING_CREDIT_LIMIT',
        cardId: row.card.id,
        currency,
      };
      accumulation.global.issues.push(issue);
      const missingBucket = accumulation.byInstitution.get(
        row.card.institutionId,
      );
      if (missingBucket) {
        missingBucket.issues.push(issue);
      }
      lines.push({
        ...baseLine,
        balance: '0',
        balanceBase: null,
      });
      continue;
    }

    const debtNative = creditCardDebt(row.balance, row.creditLimit);
    const amount = await snapshot.convert(debtNative, currency);
    lines.push({
      ...baseLine,
      balance: decimalToString(debtNative),
      balanceBase: decimalToString(amount),
    });
    accumulation.global.creditCards =
      accumulation.global.creditCards.plus(amount);
    const bucket = accumulation.byInstitution.get(row.card.institutionId);
    if (bucket) {
      bucket.creditCards = bucket.creditCards.plus(amount);
    }
  }
}

/** Préstamos: el saldo actual, nunca negativo. */
export async function addLoanLines({
  snapshot,
  accumulation,
  lines,
}: LineContext): Promise<void> {
  for (const loan of snapshot.positions.loans) {
    const currency = normalizeCurrencyCode(loan.currency);
    const current = toMoney(loan.currentBalance);
    const owed = current.isNegative() ? roundDecimal(0) : current;
    const amount = await snapshot.convert(owed, currency);
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
    accumulation.global.loans = accumulation.global.loans.plus(amount);
    const bucket = loan.institutionId
      ? accumulation.byInstitution.get(loan.institutionId)
      : undefined;
    if (bucket) {
      bucket.loans = bucket.loans.plus(amount);
    }
  }
}

export function institutionBucket(
  accumulation: BalanceSheetAccumulation,
  institutionId: string,
) {
  return accumulation.byInstitution.get(institutionId) ?? emptyBucket();
}

function creditCardDebt(
  available: MoneyLike,
  creditLimit: MoneyLike,
): Prisma.Decimal {
  const debt = roundDecimal(toMoney(creditLimit).minus(toMoney(available)));
  return debt.isNegative() ? roundDecimal(0) : debt;
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
