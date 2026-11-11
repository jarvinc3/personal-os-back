export const REVERSAL_REVIEW_REASON = {
  ORIGINAL_NOT_FOUND: 'REVERSAL_ORIGINAL_NOT_FOUND',
  REFERENCE_NOT_FOUND: 'REVERSAL_REFERENCE_NOT_FOUND',
  ORIGINAL_AMBIGUOUS: 'REVERSAL_ORIGINAL_AMBIGUOUS',
  ORIGINAL_NOT_CONFIRMED: 'REVERSAL_ORIGINAL_NOT_CONFIRMED',
  TARGET_NOT_SUPPORTED: 'REVERSAL_TARGET_NOT_SUPPORTED',
  COMMERCE_MISSING: 'REVERSAL_COMMERCE_MISSING',
  EXCEEDS_ORIGINAL: 'REVERSAL_EXCEEDS_ORIGINAL',
} as const;

export type ReversalReviewReason =
  (typeof REVERSAL_REVIEW_REASON)[keyof typeof REVERSAL_REVIEW_REASON];

export type ReversalStep = 'REFERENCE' | 'EMAIL' | 'CANDIDATE';

export type ReversalOriginal = {
  id: string;
  status: string;
  type: string;
  transferGroupId: string | null;
  amount: number;
  currency: string;
  accountId: string | null;
  cardId: string | null;
  categoryId: string | null;
  aiMetadata?: unknown;
};

export type ReversalTargetDecision =
  | {
      kind: 'full' | 'partial';
      step: ReversalStep;
      original: ReversalOriginal;
    }
  | { kind: 'already_reversed'; step: ReversalStep; original: ReversalOriginal }
  | {
      kind: 'review';
      step: ReversalStep;
      reason: ReversalReviewReason;
      candidateIds: string[];
    };

/**
 * Decides how the resolved original is compensated. A refund below the original
 * amount is a partial reversal; any refund above it needs a person.
 */
export function evaluateReversalOriginal({
  original,
  reversalAmount,
  step,
}: {
  original: ReversalOriginal;
  reversalAmount: number;
  step: ReversalStep;
}): ReversalTargetDecision {
  if (original.status === 'REVERSED') {
    return { kind: 'already_reversed', step, original };
  }
  if (original.status !== 'CONFIRMED') {
    return review({
      step,
      reason: REVERSAL_REVIEW_REASON.ORIGINAL_NOT_CONFIRMED,
      candidateIds: [original.id],
    });
  }
  if (original.type !== 'DEBIT' || original.transferGroupId !== null) {
    return review({
      step,
      reason: REVERSAL_REVIEW_REASON.TARGET_NOT_SUPPORTED,
      candidateIds: [original.id],
    });
  }
  if (reversalAmount > original.amount) {
    return review({
      step,
      reason: REVERSAL_REVIEW_REASON.EXCEEDS_ORIGINAL,
      candidateIds: [original.id],
    });
  }
  if (reversalAmount < original.amount) {
    return { kind: 'partial', step, original };
  }
  return { kind: 'full', step, original };
}

/** Only one qualifying candidate can be linked automatically. */
export function classifyReversalCandidates({
  candidates,
  reversalAmount,
  step,
}: {
  candidates: readonly ReversalOriginal[];
  reversalAmount: number;
  step: ReversalStep;
}): ReversalTargetDecision {
  if (candidates.length === 0) {
    return review({
      step,
      reason: REVERSAL_REVIEW_REASON.ORIGINAL_NOT_FOUND,
      candidateIds: [],
    });
  }
  if (candidates.length > 1) {
    return review({
      step,
      reason: REVERSAL_REVIEW_REASON.ORIGINAL_AMBIGUOUS,
      candidateIds: candidates.map((candidate) => candidate.id),
    });
  }
  return evaluateReversalOriginal({
    original: candidates[0],
    reversalAmount,
    step,
  });
}

function review({
  step,
  reason,
  candidateIds,
}: {
  step: ReversalStep;
  reason: ReversalReviewReason;
  candidateIds: string[];
}): ReversalTargetDecision {
  return { kind: 'review', step, reason, candidateIds };
}
