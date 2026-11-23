import { decimalToString } from '../../shared/domain/mappers';
import type { RecurringPeriodicity } from '../domain/recurring-detection';
import {
  annualAmount,
  daysUntil,
  monthlyAmount,
} from '../domain/recurring-alerts';
import type { RecurringPatternWithMerchant } from './recurring-types';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function mapPattern(row: RecurringPatternWithMerchant, now: Date) {
  const frequency = Number(row.frequency) as RecurringPeriodicity;
  return {
    id: row.id,
    merchantId: row.merchantId,
    merchant: row.merchant,
    merchantName: row.merchantRef?.name ?? row.merchant,
    logoUrl: row.merchantRef?.logoUrl ?? null,
    categoryId: row.categoryId,
    avgAmount: decimalToString(row.avgAmount),
    currency: row.currency,
    frequency,
    nextExpectedDate: isoDate(row.nextExpectedDate),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    status: row.status,
    kind: row.kind,
    confidenceScore: row.confidenceScore,
    amountTolerancePct: Number(row.amountTolerance),
    monthlyEquivalent: monthlyAmount(row.avgAmount, frequency).toFixed(2),
    annualEquivalent: annualAmount(row.avgAmount, frequency).toFixed(2),
    daysUntil: daysUntil(row.nextExpectedDate, now),
  };
}
