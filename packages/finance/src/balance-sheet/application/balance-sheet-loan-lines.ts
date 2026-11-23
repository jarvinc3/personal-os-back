import { decimalToString } from '../../shared/domain/mappers';
import {
  normalizeCurrencyCode,
  roundDecimal,
  toMoney,
} from '../../shared/domain/money';
import {
  BALANCE_SHEET_LINE_KIND,
  BALANCE_SHEET_RECONCILIATION,
} from '../domain/balance-sheet-breakdown';
import type { BalanceSheetLoan } from './balance-sheet-context';
import type { BalanceSheetLineInput } from './balance-sheet-line-input';
import type { BalanceSheetLineDraft } from './balance-sheet-types';

/** Loans owed; a negative balance counts as zero and keeps its line. */
export async function addLoanLines(
  input: BalanceSheetLineInput & { loans: readonly BalanceSheetLoan[] },
): Promise<BalanceSheetLineDraft[]> {
  const lines: BalanceSheetLineDraft[] = [];
  for (const loan of input.loans) {
    const currency = normalizeCurrencyCode(loan.currency);
    const current = toMoney(loan.currentBalance);
    const owed = current.isNegative() ? roundDecimal(0) : current;
    const amount = await input.rates.toBase({
      amount: owed,
      currency,
      baseCurrency: input.baseCurrency,
      asOf: input.asOf,
    });
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
    input.buckets.addLoans({
      institutionId: loan.institutionId,
      amount,
    });
  }
  return lines;
}
