import {
  adjustmentSum,
  monthBounds,
  suggestAdjustments,
} from './reconciliation-adjustment';

describe('suggestAdjustments', () => {
  it('returns nothing when the difference is zero', () => {
    expect(suggestAdjustments({ difference: 0, outgoingTotal: 1000 })).toEqual(
      [],
    );
  });

  it('proposes the 0.15 % of the outgoings as DGII and the rest as OTRO', () => {
    const suggested = suggestAdjustments({
      difference: -50,
      outgoingTotal: 10000,
    });
    expect(suggested).toEqual([
      { kind: 'IMPUESTO_DGII', amount: -15 },
      { kind: 'OTRO', amount: -35 },
    ]);
    expect(adjustmentSum(suggested)).toBe(-50);
  });

  it('falls back to a single OTRO line without outgoings', () => {
    expect(suggestAdjustments({ difference: -20, outgoingTotal: 0 })).toEqual([
      { kind: 'OTRO', amount: -20 },
    ]);
  });

  it('suggests a single OTRO line when the bank shows more money', () => {
    expect(suggestAdjustments({ difference: 25, outgoingTotal: 8000 })).toEqual(
      [{ kind: 'OTRO', amount: 25 }],
    );
  });
});

describe('monthBounds', () => {
  it('covers the whole calendar month', () => {
    const { from, to } = monthBounds('2026-10');
    expect(from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });
});
