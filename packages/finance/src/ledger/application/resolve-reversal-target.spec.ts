import {
  classifyReversalCandidates,
  evaluateReversalOriginal,
  type ReversalOriginal,
} from './resolve-reversal-target';

const original: ReversalOriginal = {
  id: 'transaction-1',
  status: 'CONFIRMED',
  type: 'DEBIT',
  transferGroupId: null,
  amount: 100,
  currency: 'DOP',
  accountId: 'account-1',
  cardId: null,
  categoryId: 'category-1',
};

describe('Reversal target', () => {
  it('reverses the whole purchase when the amount matches', () => {
    expect(
      evaluateReversalOriginal({
        original,
        reversalAmount: 100,
        step: 'REFERENCE',
      }),
    ).toEqual({ kind: 'full', step: 'REFERENCE', original });
  });

  it('links a partial reversal below the original amount', () => {
    expect(
      evaluateReversalOriginal({
        original,
        reversalAmount: 40,
        step: 'EMAIL',
      }),
    ).toEqual({ kind: 'partial', step: 'EMAIL', original });
  });

  it('sends a refund above the original to review', () => {
    expect(
      evaluateReversalOriginal({
        original,
        reversalAmount: 120,
        step: 'CANDIDATE',
      }),
    ).toMatchObject({ kind: 'review', reason: 'REVERSAL_EXCEEDS_ORIGINAL' });
  });

  it('does not compensate twice', () => {
    expect(
      evaluateReversalOriginal({
        original: { ...original, status: 'REVERSED' },
        reversalAmount: 100,
        step: 'REFERENCE',
      }),
    ).toMatchObject({ kind: 'already_reversed' });
  });

  it('reviews an original that is not confirmed', () => {
    expect(
      evaluateReversalOriginal({
        original: { ...original, status: 'PENDING' },
        reversalAmount: 100,
        step: 'REFERENCE',
      }),
    ).toMatchObject({
      kind: 'review',
      reason: 'REVERSAL_ORIGINAL_NOT_CONFIRMED',
    });
  });

  it('rejects a transfer leg or a card payment as the original', () => {
    expect(
      evaluateReversalOriginal({
        original: { ...original, type: 'CREDIT' },
        reversalAmount: 100,
        step: 'REFERENCE',
      }),
    ).toMatchObject({
      kind: 'review',
      reason: 'REVERSAL_TARGET_NOT_SUPPORTED',
    });
    expect(
      evaluateReversalOriginal({
        original: { ...original, transferGroupId: 'group-1' },
        reversalAmount: 100,
        step: 'REFERENCE',
      }),
    ).toMatchObject({
      kind: 'review',
      reason: 'REVERSAL_TARGET_NOT_SUPPORTED',
    });
    expect(
      evaluateReversalOriginal({
        original: { ...original, type: 'CARD_PAYMENT' },
        reversalAmount: 100,
        step: 'REFERENCE',
      }),
    ).toMatchObject({
      kind: 'review',
      reason: 'REVERSAL_TARGET_NOT_SUPPORTED',
    });
  });

  it('reviews zero candidates and ambiguous candidates', () => {
    expect(
      classifyReversalCandidates({
        candidates: [],
        reversalAmount: 100,
        step: 'CANDIDATE',
      }),
    ).toMatchObject({
      kind: 'review',
      reason: 'REVERSAL_ORIGINAL_NOT_FOUND',
    });
    expect(
      classifyReversalCandidates({
        candidates: [original, { ...original, id: 'transaction-2' }],
        reversalAmount: 100,
        step: 'CANDIDATE',
      }),
    ).toMatchObject({
      kind: 'review',
      reason: 'REVERSAL_ORIGINAL_AMBIGUOUS',
      candidateIds: ['transaction-1', 'transaction-2'],
    });
  });

  it('links the only valid candidate', () => {
    expect(
      classifyReversalCandidates({
        candidates: [original],
        reversalAmount: 100,
        step: 'CANDIDATE',
      }),
    ).toEqual({ kind: 'full', step: 'CANDIDATE', original });
  });
});
