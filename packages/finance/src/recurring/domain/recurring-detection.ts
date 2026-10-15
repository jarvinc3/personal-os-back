/**
 * Detects recurring charges from a merchant's movement history.
 *
 * Pure function: the caller passes the charges and the clock, so the rule is
 * testable without a database.
 */

export const RECURRING_PERIODICITIES = [7, 14, 30, 365] as const;
export type RecurringPeriodicity = (typeof RECURRING_PERIODICITIES)[number];

/** Every periodicity accepts a gap this many days away from the ideal. */
export const PERIODICITY_TOLERANCE_DAYS: Record<RecurringPeriodicity, number> =
  {
    7: 2,
    14: 3,
    30: 5,
    365: 20,
  };

export const DETECTION_MIN_OCCURRENCES = 3;
/** A user-confirmed annual pattern survives with two charges. */
export const CONFIRMED_ANNUAL_MIN_OCCURRENCES = 2;
export const DEFAULT_AMOUNT_TOLERANCE_PCT = 10;

const MS_PER_DAY = 86_400_000;

export type MerchantCharge = {
  id: string;
  amount: number;
  date: Date;
};

export type DetectedPattern = {
  merchantId: string;
  merchantName: string;
  currency: string;
  categoryId: string | null;
  avgAmount: number;
  frequency: RecurringPeriodicity;
  nextExpectedDate: Date;
  lastSeenAt: Date;
  occurrences: number;
  confidenceScore: number;
  amountTolerancePct: number;
};

export type DetectRecurringInput = {
  merchantId: string;
  merchantName: string;
  currency: string;
  categoryId?: string | null;
  charges: MerchantCharge[];
  today: Date;
  amountTolerancePct?: number;
  /** Set when the user already confirmed this annual merchant. */
  allowTwoOccurrences?: boolean;
};

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function matchPeriodicity(averageGap: number): RecurringPeriodicity | null {
  let best: RecurringPeriodicity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const periodicity of RECURRING_PERIODICITIES) {
    const distance = Math.abs(averageGap - periodicity);
    if (distance > PERIODICITY_TOLERANCE_DAYS[periodicity]) {
      continue;
    }
    if (distance < bestDistance) {
      best = periodicity;
      bestDistance = distance;
    }
  }
  return best;
}

function confidenceFor(occurrences: number, maxDeviation: number): number {
  const base = Math.min(70, 40 + occurrences * 10);
  const penalty = Math.min(25, Math.round(maxDeviation * 3));
  return Math.max(0, Math.min(100, base - penalty));
}

export function detectRecurringPattern(
  input: DetectRecurringInput,
): DetectedPattern | null {
  const charges = [...input.charges].sort(
    (left, right) => left.date.getTime() - right.date.getTime(),
  );
  const minimum = input.allowTwoOccurrences
    ? CONFIRMED_ANNUAL_MIN_OCCURRENCES
    : DETECTION_MIN_OCCURRENCES;
  if (charges.length < minimum) {
    return null;
  }

  const tolerancePct = input.amountTolerancePct ?? DEFAULT_AMOUNT_TOLERANCE_PCT;
  const amounts = charges.map((charge) => charge.amount);
  const avgAmount =
    amounts.reduce((total, amount) => total + amount, 0) / amounts.length;
  if (avgAmount <= 0) {
    return null;
  }
  const withinTolerance = amounts.every(
    (amount) =>
      (Math.abs(amount - avgAmount) / avgAmount) * 100 <= tolerancePct,
  );
  if (!withinTolerance) {
    return null;
  }

  const gaps: number[] = [];
  for (let index = 1; index < charges.length; index += 1) {
    gaps.push(daysBetween(charges[index - 1].date, charges[index].date));
  }
  if (gaps.length === 0) {
    return null;
  }

  const averageGap = median(gaps);
  const periodicity = matchPeriodicity(averageGap);
  if (!periodicity) {
    return null;
  }
  if (
    charges.length === CONFIRMED_ANNUAL_MIN_OCCURRENCES &&
    periodicity !== 365
  ) {
    return null;
  }

  const toleranceDays = PERIODICITY_TOLERANCE_DAYS[periodicity];
  const maxDeviation = Math.max(
    ...gaps.map((gap) => Math.abs(gap - periodicity)),
  );
  if (maxDeviation > toleranceDays) {
    return null;
  }

  const last = charges[charges.length - 1];
  const nextExpectedDate = new Date(
    last.date.getTime() + periodicity * MS_PER_DAY,
  );

  return {
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    currency: input.currency,
    categoryId: input.categoryId ?? null,
    avgAmount,
    frequency: periodicity,
    nextExpectedDate,
    lastSeenAt: last.date,
    occurrences: charges.length,
    confidenceScore: confidenceFor(charges.length, maxDeviation),
    amountTolerancePct: tolerancePct,
  };
}
