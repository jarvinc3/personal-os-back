import type { Prisma } from '@personal-os/database';
import {
  decimalToNullableString,
  decimalToString,
} from '../../shared/domain/mappers';
import {
  normalizeCurrencyCode,
  roundDecimal,
  toMoney,
  type MoneyLike,
} from '../../shared/domain/money';
import { BALANCE_SHEET_LINE_KIND } from '../domain/balance-sheet-breakdown';
import type { BalanceSheetCardBalance } from './balance-sheet-context';
import {
  cardKey,
  driftValue,
  reconciliationState,
} from './balance-sheet-indexes';
import type { BalanceSheetLineInput } from './balance-sheet-line-input';
import type {
  BalanceSheetIssue,
  BalanceSheetLineDraft,
} from './balance-sheet-types';

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

/** Credit cards by currency; without a limit the line is a zero placeholder. */
export async function addCardLines(
  input: BalanceSheetLineInput & {
    cardBalances: readonly BalanceSheetCardBalance[];
  },
): Promise<BalanceSheetLineDraft[]> {
  const lines: BalanceSheetLineDraft[] = [];
  for (const row of input.cardBalances) {
    const currency = normalizeCurrencyCode(row.currency);
    const drift = driftValue(
      input.indexes.driftByCard.get(cardKey(row.card.id, currency)),
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
        input.indexes.reconciledKeys,
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
      input.buckets.addIssue(issue, row.card.institutionId);
      lines.push({
        ...baseLine,
        balance: '0',
        balanceBase: null,
      });
      continue;
    }

    const debtNative = creditCardDebt(row.balance, row.creditLimit);
    const amount = await input.rates.toBase({
      amount: debtNative,
      currency,
      baseCurrency: input.baseCurrency,
      asOf: input.asOf,
    });
    lines.push({
      ...baseLine,
      balance: decimalToString(debtNative),
      balanceBase: decimalToString(amount),
    });
    input.buckets.addCreditCards({
      institutionId: row.card.institutionId,
      amount,
    });
  }
  return lines;
}
