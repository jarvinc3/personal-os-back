import { CASH_ACCOUNT_TYPE } from '../../shared/domain/cash';
import {
  decimalToNullableString,
  decimalToString,
} from '../../shared/domain/mappers';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import { BALANCE_SHEET_LINE_KIND } from '../domain/balance-sheet-breakdown';
import type { BalanceSheetAccount } from './balance-sheet-context';
import {
  accountKey,
  driftValue,
  reconciliationState,
} from './balance-sheet-indexes';
import type { BalanceSheetLineInput } from './balance-sheet-line-input';
import type { BalanceSheetLineDraft } from './balance-sheet-types';

/** Accounts and cash, including their informational cash subset. */
export async function addAccountLines(
  input: BalanceSheetLineInput & {
    accounts: readonly BalanceSheetAccount[];
  },
): Promise<BalanceSheetLineDraft[]> {
  const lines: BalanceSheetLineDraft[] = [];
  for (const account of input.accounts) {
    const currency = normalizeCurrencyCode(account.currency);
    const isCash = account.type === CASH_ACCOUNT_TYPE;
    const converted = await input.rates.toBaseOrNull({
      amount: account.balance,
      currency,
      baseCurrency: input.baseCurrency,
      asOf: input.asOf,
    });
    const drift = driftValue(
      input.indexes.driftByAccount.get(accountKey(account.id, currency)),
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
        input.indexes.reconciledKeys,
        accountKey(account.id, currency),
      ),
      creditLimit: null,
      availableCredit: null,
      dueDate: null,
      doubtful: false,
    });

    if (converted === null) {
      input.buckets.addIssue(
        { code: 'MISSING_RATE', currency },
        account.institutionId,
      );
      continue;
    }
    input.buckets.addAccount({
      institutionId: account.institutionId,
      amount: converted,
      isCash,
    });
  }
  return lines;
}
