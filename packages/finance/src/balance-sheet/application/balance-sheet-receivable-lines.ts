import type { Prisma } from '@personal-os/database';
import { localDayStart } from '../../shared/domain/local-day';
import {
  decimalToNullableString,
  decimalToString,
} from '../../shared/domain/mappers';
import {
  normalizeCurrencyCode,
  roundDecimal,
  toMoney,
} from '../../shared/domain/money';
import {
  BALANCE_SHEET_LINE_KIND,
  BALANCE_SHEET_RECONCILIATION,
} from '../domain/balance-sheet-breakdown';
import type { BalanceSheetLineInput } from './balance-sheet-line-input';
import type {
  BalanceSheetLineDraft,
  ReceivableRow,
} from './balance-sheet-types';

const DOUBTFUL_RECEIVABLE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function receivableOutstanding(row: ReceivableRow): Prisma.Decimal {
  const outstanding = roundDecimal(
    toMoney(row.amount)
      .minus(toMoney(row.paidAmount))
      .minus(toMoney(row.writtenOffAmount)),
  );
  return outstanding.isNegative() ? roundDecimal(0) : outstanding;
}

/** Pending receivables; an overdue one is marked doubtful and does not sum. */
export async function buildReceivableLines(
  input: BalanceSheetLineInput & {
    receivables: readonly ReceivableRow[];
    timezone: string | null;
  },
): Promise<BalanceSheetLineDraft[]> {
  const today = localDayStart(input.timezone, input.asOf);
  const doubtfulCutoff = new Date(
    today.getTime() - DOUBTFUL_RECEIVABLE_DAYS * DAY_MS,
  );
  const lines: BalanceSheetLineDraft[] = [];
  for (const receivable of input.receivables) {
    const outstanding = receivableOutstanding(receivable);
    if (outstanding.isZero()) {
      continue;
    }
    const currency = normalizeCurrencyCode(receivable.currency);
    const doubtful =
      receivable.dueDate !== null && receivable.dueDate < doubtfulCutoff;
    const converted = await input.rates.toBaseOrNull({
      amount: outstanding,
      currency,
      baseCurrency: input.baseCurrency,
      asOf: input.asOf,
    });
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
  return lines;
}
