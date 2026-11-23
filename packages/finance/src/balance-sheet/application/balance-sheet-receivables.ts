import type { Prisma } from '@personal-os/database';
import {
  decimalToString,
  decimalToNullableString,
} from '../../shared/domain/mappers';
import { localDayStart } from '../../shared/domain/local-day';
import {
  normalizeCurrencyCode,
  roundDecimal,
  toMoney,
} from '../../shared/domain/money';
import {
  BALANCE_SHEET_LINE_KIND,
  BALANCE_SHEET_RECONCILIATION,
} from '../domain/balance-sheet-breakdown';
import type { BalanceSheetLine } from '../domain/balance-sheet-breakdown';
import type { BalanceSheetAccumulation } from './balance-sheet-buckets';
import type { BalanceSheetSnapshot } from './balance-sheet-snapshot';

type ReceivableLineContext = {
  snapshot: BalanceSheetSnapshot;
  accumulation: BalanceSheetAccumulation;
  lines: Array<Omit<BalanceSheetLine, 'entity'>>;
};

const DOUBTFUL_RECEIVABLE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Cuentas por cobrar: la vencida es dudosa y no marca la hoja incompleta. */
export async function addReceivableLines({
  snapshot,
  accumulation,
  lines,
}: ReceivableLineContext): Promise<void> {
  const today = localDayStart(snapshot.timezone, snapshot.asOf);
  const doubtfulCutoff = new Date(
    today.getTime() - DOUBTFUL_RECEIVABLE_DAYS * DAY_MS,
  );
  for (const receivable of snapshot.receivables) {
    const outstanding = receivableOutstanding(receivable);
    if (outstanding.isZero()) {
      continue;
    }
    const currency = normalizeCurrencyCode(receivable.currency);
    const doubtful =
      receivable.dueDate !== null && receivable.dueDate < doubtfulCutoff;
    const converted = await snapshot.convertOrNull(outstanding, currency);
    if (converted === null && !doubtful) {
      accumulation.global.issues.push({ code: 'MISSING_RATE', currency });
    }
    if (converted !== null && !doubtful) {
      accumulation.global.receivables =
        accumulation.global.receivables.plus(converted);
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
}

function receivableOutstanding(row: ReceivableRow): Prisma.Decimal {
  const outstanding = roundDecimal(
    toMoney(row.amount)
      .minus(toMoney(row.paidAmount))
      .minus(toMoney(row.writtenOffAmount)),
  );
  return outstanding.isNegative() ? roundDecimal(0) : outstanding;
}
