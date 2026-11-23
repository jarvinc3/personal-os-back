import type { Prisma } from '@personal-os/database';
import type { FxRateRequestCache } from '../../fx/application/resolve-amounts.use-case';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import { decimalToString } from '../../shared/domain/mappers';
import { normalizeCurrencyCode, roundDecimal } from '../../shared/domain/money';
import type { BalanceSheetRepository } from '../infrastructure/balance-sheet.repository';
import type {
  CashAccountLine,
  CashCurrencyBreakdown,
  FinanceCashSummary,
} from './balance-sheet-types';

/** Efectivo convertido a la moneda base, con su desglose por moneda. */
export async function buildCashSummary({
  repo,
  resolveAmounts,
  userId,
  baseCurrency,
  asOf,
  rateCache,
}: {
  repo: BalanceSheetRepository;
  resolveAmounts: ResolveAmountsUseCase;
  userId: string;
  baseCurrency: string;
  asOf: Date;
  rateCache: FxRateRequestCache;
}): Promise<FinanceCashSummary> {
  const accounts = await repo.loadCashAccounts(userId);
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
    const converted = await resolveAmounts.toBaseCurrencyOrNull(
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
