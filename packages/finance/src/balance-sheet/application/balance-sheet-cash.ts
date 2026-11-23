import type { Prisma } from '@personal-os/database';
import { decimalToString } from '../../shared/domain/mappers';
import { normalizeCurrencyCode, roundDecimal } from '../../shared/domain/money';
import type { BalanceSheetRepository } from '../infrastructure/balance-sheet.repository';
import type { BalanceSheetRates } from './balance-sheet-rates';
import type {
  CashAccountLine,
  CashCurrencyBreakdown,
  FinanceCashSummary,
} from './balance-sheet-types';

/** Cash accounts grouped by currency, converted to the user's base currency. */
export class BalanceSheetCash {
  constructor(private readonly repo: BalanceSheetRepository) {}

  async summary(input: {
    userId: string;
    baseCurrency: string;
    asOf: Date;
    rates: BalanceSheetRates;
  }): Promise<FinanceCashSummary> {
    const accounts = await this.repo.loadCashAccounts(input.userId);
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
      const converted = await input.rates.toBaseOrNull({
        amount: group.total,
        currency,
        baseCurrency: input.baseCurrency,
        asOf: input.asOf,
      });
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
      baseCurrency: input.baseCurrency,
      rateDate: input.asOf.toISOString().slice(0, 10),
      status: incomplete ? 'INCOMPLETE' : 'COMPLETE',
      byCurrency,
    };
  }
}
