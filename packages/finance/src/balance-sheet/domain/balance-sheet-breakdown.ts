import { Prisma } from '@personal-os/database';
import {
  decimalToNullableString,
  decimalToString,
} from '../../shared/domain/mappers';
import {
  normalizeCurrencyCode,
  roundDecimal,
  sumMoney,
  toMoney,
} from '../../shared/domain/money';

export const BALANCE_SHEET_LINE_KIND = {
  ACCOUNT: 'ACCOUNT',
  CASH: 'CASH',
  RECEIVABLE: 'RECEIVABLE',
  CREDIT_CARD: 'CREDIT_CARD',
  LOAN: 'LOAN',
} as const;

export type BalanceSheetLineKind =
  (typeof BALANCE_SHEET_LINE_KIND)[keyof typeof BALANCE_SHEET_LINE_KIND];

export const BALANCE_SHEET_RECONCILIATION = {
  RECONCILED: 'RECONCILED',
  PENDING: 'PENDING',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;

export type BalanceSheetReconciliation =
  (typeof BALANCE_SHEET_RECONCILIATION)[keyof typeof BALANCE_SHEET_RECONCILIATION];

/** One product in the net-worth breakdown, already converted to the base currency. */
export type BalanceSheetLine = {
  id: string;
  kind: BalanceSheetLineKind;
  name: string;
  description: string | null;
  institutionId: string | null;
  currency: string;
  /** Native amount: cash and account balance, card debt, loan owed, or receivable outstanding. */
  balance: string;
  /** `balance` in the user's base currency; null when no rate was available. */
  balanceBase: string | null;
  hasDrift: boolean;
  driftDifference: string | null;
  reconciliation: BalanceSheetReconciliation;
  creditLimit: string | null;
  availableCredit: string | null;
  dueDate: string | null;
  doubtful: boolean;
};

export type BalanceSheetCurrencyTotals = {
  assets: string;
  available: string;
  receivables: string;
  liabilities: string;
  netWorth: string;
  doubtfulReceivables: string;
};

export type BalanceSheetCurrencyTotalsBase = {
  assets: string | null;
  available: string | null;
  receivables: string | null;
  liabilities: string | null;
  netWorth: string | null;
  doubtfulReceivables: string | null;
};

export type BalanceSheetCurrencyGroup = {
  currency: string;
  accounts: BalanceSheetLine[];
  cash: BalanceSheetLine[];
  receivables: BalanceSheetLine[];
  creditCards: BalanceSheetLine[];
  loans: BalanceSheetLine[];
  doubtfulReceivables: BalanceSheetLine[];
  totals: BalanceSheetCurrencyTotals;
  totalsBase: BalanceSheetCurrencyTotalsBase;
};

export type BalanceSheetBreakdown = {
  byCurrency: BalanceSheetCurrencyGroup[];
  totals: BalanceSheetCurrencyTotalsBase;
};

function sumNative(lines: readonly BalanceSheetLine[]): Prisma.Decimal {
  return roundDecimal(sumMoney(lines.map((line) => line.balance)));
}

function sumBase(lines: readonly BalanceSheetLine[]): Prisma.Decimal | null {
  if (lines.some((line) => line.balanceBase === null)) {
    return null;
  }
  return roundDecimal(
    lines.reduce(
      (total, line) => total.plus(toMoney(line.balanceBase)),
      new Prisma.Decimal(0),
    ),
  );
}

function addBase(
  values: ReadonlyArray<Prisma.Decimal | null>,
): Prisma.Decimal | null {
  if (values.some((value) => value === null)) {
    return null;
  }
  return roundDecimal(
    values.reduce<Prisma.Decimal>(
      (total, value) => total.plus(value ?? 0),
      new Prisma.Decimal(0),
    ),
  );
}

function subtractBase(
  left: Prisma.Decimal | null,
  right: Prisma.Decimal | null,
): Prisma.Decimal | null {
  if (left === null || right === null) {
    return null;
  }
  return roundDecimal(left.minus(right));
}

function baseToString(value: Prisma.Decimal | null): string | null {
  return decimalToNullableString(value);
}

function sortLines(lines: BalanceSheetLine[]): BalanceSheetLine[] {
  return [...lines].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}

function buildCurrencyGroup(
  currency: string,
  lines: readonly BalanceSheetLine[],
): BalanceSheetCurrencyGroup {
  const accounts = sortLines(
    lines.filter((line) => line.kind === BALANCE_SHEET_LINE_KIND.ACCOUNT),
  );
  const cash = sortLines(
    lines.filter((line) => line.kind === BALANCE_SHEET_LINE_KIND.CASH),
  );
  const receivables = sortLines(
    lines.filter(
      (line) =>
        line.kind === BALANCE_SHEET_LINE_KIND.RECEIVABLE && !line.doubtful,
    ),
  );
  const doubtfulReceivables = sortLines(
    lines.filter(
      (line) =>
        line.kind === BALANCE_SHEET_LINE_KIND.RECEIVABLE && line.doubtful,
    ),
  );
  const creditCards = sortLines(
    lines.filter((line) => line.kind === BALANCE_SHEET_LINE_KIND.CREDIT_CARD),
  );
  const loans = sortLines(
    lines.filter((line) => line.kind === BALANCE_SHEET_LINE_KIND.LOAN),
  );
  const availableLines = [...accounts, ...cash];
  const receivableLines = receivables;
  const liabilityLines = [...creditCards, ...loans];

  const available = sumNative(availableLines);
  const receivablesTotal = sumNative(receivableLines);
  const assets = roundDecimal(available.plus(receivablesTotal));
  const liabilities = sumNative(liabilityLines);
  const availableBase = sumBase(availableLines);
  const receivablesBase = sumBase(receivableLines);
  const assetsBase = addBase([availableBase, receivablesBase]);
  const liabilitiesBase = sumBase(liabilityLines);
  const netWorthBase = subtractBase(assetsBase, liabilitiesBase);

  return {
    currency,
    accounts,
    cash,
    receivables,
    creditCards,
    loans,
    doubtfulReceivables,
    totals: {
      assets: decimalToString(assets),
      available: decimalToString(available),
      receivables: decimalToString(receivablesTotal),
      liabilities: decimalToString(liabilities),
      netWorth: decimalToString(roundDecimal(assets.minus(liabilities))),
      doubtfulReceivables: decimalToString(sumNative(doubtfulReceivables)),
    },
    totalsBase: {
      assets: baseToString(assetsBase),
      available: baseToString(availableBase),
      receivables: baseToString(receivablesBase),
      liabilities: baseToString(liabilitiesBase),
      netWorth: baseToString(netWorthBase),
      doubtfulReceivables: baseToString(sumBase(doubtfulReceivables)),
    },
  };
}

function sumGroupTotals(
  groups: readonly BalanceSheetCurrencyGroup[],
  select: (group: BalanceSheetCurrencyGroup) => string | null,
): string | null {
  const values = groups.map(select);
  if (values.some((value) => value === null)) {
    return null;
  }
  return decimalToString(
    roundDecimal(
      values.reduce(
        (total, value) => total.plus(toMoney(value)),
        new Prisma.Decimal(0),
      ),
    ),
  );
}

/** Groups product lines by currency and derives every total from those lines. */
export function groupBalanceSheetLines(
  lines: readonly BalanceSheetLine[],
  baseCurrency: string,
): BalanceSheetBreakdown {
  const byCurrencyCode = new Map<string, BalanceSheetLine[]>();
  for (const line of lines) {
    const currency = normalizeCurrencyCode(line.currency);
    const group = byCurrencyCode.get(currency) ?? [];
    group.push(line);
    byCurrencyCode.set(currency, group);
  }

  const normalizedBase = normalizeCurrencyCode(baseCurrency);
  const byCurrency = [...byCurrencyCode.entries()]
    .map(([currency, groupLines]) => buildCurrencyGroup(currency, groupLines))
    .sort((left, right) => {
      if (left.currency === normalizedBase) {
        return -1;
      }
      if (right.currency === normalizedBase) {
        return 1;
      }
      return left.currency.localeCompare(right.currency);
    });

  return {
    byCurrency,
    totals: {
      assets: sumGroupTotals(byCurrency, (group) => group.totalsBase.assets),
      available: sumGroupTotals(
        byCurrency,
        (group) => group.totalsBase.available,
      ),
      receivables: sumGroupTotals(
        byCurrency,
        (group) => group.totalsBase.receivables,
      ),
      liabilities: sumGroupTotals(
        byCurrency,
        (group) => group.totalsBase.liabilities,
      ),
      netWorth: sumGroupTotals(
        byCurrency,
        (group) => group.totalsBase.netWorth,
      ),
      doubtfulReceivables: sumGroupTotals(
        byCurrency,
        (group) => group.totalsBase.doubtfulReceivables,
      ),
    },
  };
}
