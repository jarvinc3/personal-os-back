import type { Prisma } from '@personal-os/database';
import type { FxRateRequestCache } from '../../fx/application/resolve-amounts.use-case';
import type { ResolveAmountsUseCase } from '../../fx/application/resolve-amounts.use-case';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { monthBounds } from '../../reconciliation/domain/reconciliation-adjustment';
import { localDateIso } from '../../shared/domain/local-day';
import {
  normalizeCurrencyCode,
  type MoneyLike,
} from '../../shared/domain/money';
import type { BalanceSheetRepository } from '../infrastructure/balance-sheet.repository';

export type BalanceSheetSnapshot = Awaited<
  ReturnType<typeof loadBalanceSheetSnapshot>
>;

/** Todo lo que la hoja lee una vez: fecha de corte, foto y conversor. */
export async function loadBalanceSheetSnapshot({
  repo,
  baseCurrency,
  resolveAmounts,
  userId,
}: {
  repo: BalanceSheetRepository;
  baseCurrency: ResolveUserBaseCurrencyUseCase;
  resolveAmounts: ResolveAmountsUseCase;
  userId: string;
}) {
  const asOf = new Date();
  const rateDate = asOf.toISOString().slice(0, 10);
  const userBaseCurrency = await baseCurrency.execute(userId);
  const timezone = await repo.loadUserTimezone(userId);
  const month = localDateIso(timezone, asOf).slice(0, 7);
  const { from, to } = monthBounds(month);
  const [positions, receivables, drifts, reconciliations] = await Promise.all([
    repo.loadPositions(userId),
    repo.loadReceivables(userId),
    repo.loadOpenDrifts(userId),
    repo.loadMonthReconciliations(userId, from, to),
  ]);
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
  return {
    asOf,
    rateDate,
    baseCurrency: userBaseCurrency,
    timezone,
    positions,
    receivables,
    reconciledKeys,
    driftByAccount,
    driftByCard,
    rateCache,
    convert: (amount: MoneyLike, currency: string) =>
      resolveAmounts.toBaseCurrency(
        amount,
        currency,
        userBaseCurrency,
        asOf,
        rateCache,
      ),
    convertOrNull: (amount: MoneyLike, currency: string) =>
      resolveAmounts.toBaseCurrencyOrNull(
        amount,
        currency,
        userBaseCurrency,
        asOf,
        rateCache,
      ),
  };
}

export function accountKey(accountId: string, currency: string): string {
  return `account:${accountId}:${normalizeCurrencyCode(currency)}`;
}

export function cardKey(cardId: string, currency: string): string {
  return `card:${cardId}:${normalizeCurrencyCode(currency)}`;
}
