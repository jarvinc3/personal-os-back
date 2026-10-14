import { roundMoney } from '../../shared/domain/money';

export const RECONCILIATION_ADJUSTMENT_KINDS = [
  'IMPUESTO_DGII',
  'COMISION',
  'CARGO_PLASTICO',
  'INTERES',
  'OTRO',
] as const;

export type ReconciliationAdjustmentKind =
  (typeof RECONCILIATION_ADJUSTMENT_KINDS)[number];

/** DGII charges 0.15 % on each account movement. */
export const DGII_TAX_RATE = 0.0015;

/**
 * System category each kind books to. COMISION and INTERES reuse the
 * categories seeded for card charges; the other three come with the
 * reconciliation migration.
 */
export const SYSTEM_KIND_BY_ADJUSTMENT_KIND: Record<
  ReconciliationAdjustmentKind,
  string
> = {
  IMPUESTO_DGII: 'TAX_DGII',
  COMISION: 'FEE',
  CARGO_PLASTICO: 'PLASTIC_FEE',
  INTERES: 'INTEREST',
  OTRO: 'OTHER_BANK_CHARGE',
};

export type SuggestedAdjustment = {
  kind: ReconciliationAdjustmentKind;
  amount: number;
};

/**
 * Splits the difference into lines. With money out of the product and a
 * shortfall, the 0.15 % of those outgoings is proposed as DGII and the rest
 * as OTRO; the lines always add up to the difference.
 */
export function suggestAdjustments(input: {
  difference: number;
  outgoingTotal: number;
}): SuggestedAdjustment[] {
  const difference = roundMoney(input.difference);
  if (difference === 0) {
    return [];
  }

  const dgiiEstimate =
    input.outgoingTotal > 0 && difference < 0
      ? roundMoney(input.outgoingTotal * DGII_TAX_RATE)
      : 0;
  if (dgiiEstimate === 0) {
    return [{ kind: 'OTRO', amount: difference }];
  }

  const dgii = -dgiiEstimate;
  return [
    { kind: 'IMPUESTO_DGII', amount: dgii },
    { kind: 'OTRO', amount: roundMoney(difference - dgii) },
  ];
}

/** Sum of signed adjustment amounts, rounded to money precision. */
export function adjustmentSum(
  adjustments: readonly { amount: number }[],
): number {
  return roundMoney(
    adjustments.reduce((total, adjustment) => total + adjustment.amount, 0),
  );
}

export function monthBounds(month: string): { from: Date; to: Date } {
  const [year, monthNumber] = month.split('-').map(Number);
  const from = new Date(Date.UTC(year, monthNumber - 1, 1));
  const to = new Date(Date.UTC(year, monthNumber, 0));
  return { from, to };
}
