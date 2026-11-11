import type { ReversalReviewReason } from './resolve-reversal-target';

export class PartialReversalAlreadyAppliedError extends Error {
  readonly transactionId: string;

  constructor({ transactionId }: { transactionId: string }) {
    super(`Partial reversal already applied: ${transactionId}`);
    this.name = 'PartialReversalAlreadyAppliedError';
    this.transactionId = transactionId;
  }
}

export class PartialReversalAlreadyReversedError extends Error {
  readonly originalId: string;

  constructor({ originalId }: { originalId: string }) {
    super(`Partial reversal original already reversed: ${originalId}`);
    this.name = 'PartialReversalAlreadyReversedError';
    this.originalId = originalId;
  }
}

export class PartialReversalExceedsOriginalError extends Error {
  readonly originalId: string;

  constructor({ originalId }: { originalId: string }) {
    super(`Partial reversal exceeds original: ${originalId}`);
    this.name = 'PartialReversalExceedsOriginalError';
    this.originalId = originalId;
  }
}

export class PartialReversalNotApplicableError extends Error {
  readonly originalId: string;
  readonly reason: ReversalReviewReason;

  constructor({
    originalId,
    reason,
  }: {
    originalId: string;
    reason: ReversalReviewReason;
  }) {
    super(`Partial reversal not applicable: ${reason}`);
    this.name = 'PartialReversalNotApplicableError';
    this.originalId = originalId;
    this.reason = reason;
  }
}
