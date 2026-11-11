import { normalizeSender } from '../knowledge/knowledge-normalizer';
import type { ReviewGroup } from './review-groups.util';

export type ReviewQueueImpactCandidate = {
  id: string;
  pendingInGroup: number;
  senderKnown: boolean;
  confidence: number | null;
  receivedAt: Date;
};

export function reviewGroupImpactKey(
  fromAddress: string,
  templateFingerprint: string | null,
): string {
  return JSON.stringify([fromAddress, templateFingerprint]);
}

export function sortReviewGroupsByImpact<
  T extends Pick<
    ReviewGroup,
    'fromAddress' | 'templateFingerprint' | 'pending' | 'total'
  >,
>(
  groups: readonly T[],
  {
    knownSenders,
    confidenceByGroup,
  }: {
    knownSenders: ReadonlySet<string>;
    confidenceByGroup: ReadonlyMap<string, number | null>;
  },
): T[] {
  return [...groups].sort((left, right) => {
    if (left.pending !== right.pending) {
      return right.pending - left.pending;
    }
    const knownDelta =
      Number(isKnownSender(left.fromAddress, knownSenders)) -
      Number(isKnownSender(right.fromAddress, knownSenders));
    if (knownDelta !== 0) {
      return knownDelta;
    }
    const confidenceDelta = compareConfidence(
      confidenceByGroup.get(
        reviewGroupImpactKey(left.fromAddress, left.templateFingerprint),
      ) ?? null,
      confidenceByGroup.get(
        reviewGroupImpactKey(right.fromAddress, right.templateFingerprint),
      ) ?? null,
    );
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    if (left.total !== right.total) {
      return right.total - left.total;
    }
    return (
      compareText(left.fromAddress, right.fromAddress) ||
      compareText(
        left.templateFingerprint ?? '',
        right.templateFingerprint ?? '',
      )
    );
  });
}

export function sortReviewQueueByImpact<T extends ReviewQueueImpactCandidate>(
  items: readonly T[],
): T[] {
  return [...items].sort((left, right) => {
    if (left.pendingInGroup !== right.pendingInGroup) {
      return right.pendingInGroup - left.pendingInGroup;
    }
    if (left.senderKnown !== right.senderKnown) {
      return left.senderKnown ? 1 : -1;
    }
    const confidenceDelta = compareConfidence(
      left.confidence,
      right.confidence,
    );
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    return (
      left.receivedAt.getTime() - right.receivedAt.getTime() ||
      compareText(left.id, right.id)
    );
  });
}

export function isKnownSender(
  sender: string,
  knownSenders: ReadonlySet<string>,
): boolean {
  const normalized = normalizeSender(sender);
  return normalized !== null && knownSenders.has(normalized);
}

function compareConfidence(left: number | null, right: number | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
