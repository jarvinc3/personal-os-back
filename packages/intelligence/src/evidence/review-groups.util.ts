import type { EmailDatasetPartition } from './dataset-partition.util';

export type ReviewGroupMessage = {
  id: string;
  fromAddress: string;
  subject: string;
  templateFingerprint: string | null;
};

export type ReviewGroup = {
  fromAddress: string;
  templateFingerprint: string | null;
  total: number;
  pending: number;
  pendingHoldout: number;
  sampleSubjects: string[];
  /** Parallel to `sampleSubjects`: `sampleMessageIds[i]` is its message. */
  sampleMessageIds: string[];
};

type ReviewGroupInput = {
  messages: readonly ReviewGroupMessage[];
  partitionByMessageId: ReadonlyMap<string, EmailDatasetPartition>;
  reviewedMessageIds: ReadonlySet<string>;
  sampleSize: number;
};

type AccumulateGroupInput = {
  group: ReviewGroup;
  message: ReviewGroupMessage;
  partition: EmailDatasetPartition;
  reviewed: boolean;
  sampleSize: number;
};

export function groupReviewMessages({
  messages,
  partitionByMessageId,
  reviewedMessageIds,
  sampleSize,
}: ReviewGroupInput): ReviewGroup[] {
  const groupsBySender = new Map<string, Map<string | null, ReviewGroup>>();
  for (const message of messages) {
    const partition = partitionByMessageId.get(message.id);
    if (!partition) {
      continue;
    }
    const groupsByTemplate =
      groupsBySender.get(message.fromAddress) ??
      new Map<string | null, ReviewGroup>();
    const group =
      groupsByTemplate.get(message.templateFingerprint) ?? emptyGroup(message);
    groupsByTemplate.set(
      message.templateFingerprint,
      accumulateGroup({
        group,
        message,
        partition,
        reviewed: reviewedMessageIds.has(message.id),
        sampleSize,
      }),
    );
    groupsBySender.set(message.fromAddress, groupsByTemplate);
  }
  return collectGroups(groupsBySender).sort(compareGroups);
}

function emptyGroup(message: ReviewGroupMessage): ReviewGroup {
  return {
    fromAddress: message.fromAddress,
    templateFingerprint: message.templateFingerprint,
    total: 0,
    pending: 0,
    pendingHoldout: 0,
    sampleSubjects: [],
    sampleMessageIds: [],
  };
}

function accumulateGroup({
  group,
  message,
  partition,
  reviewed,
  sampleSize,
}: AccumulateGroupInput): ReviewGroup {
  const addsSample =
    group.sampleSubjects.length < sampleSize &&
    !group.sampleSubjects.includes(message.subject);
  const pendingIncrement = reviewed ? 0 : 1;
  const holdoutIncrement = !reviewed && partition === 'HOLDOUT' ? 1 : 0;
  return {
    fromAddress: group.fromAddress,
    templateFingerprint: group.templateFingerprint,
    total: group.total + 1,
    pending: group.pending + pendingIncrement,
    pendingHoldout: group.pendingHoldout + holdoutIncrement,
    sampleSubjects: addsSample
      ? [...group.sampleSubjects, message.subject]
      : group.sampleSubjects,
    sampleMessageIds: addsSample
      ? [...group.sampleMessageIds, message.id]
      : group.sampleMessageIds,
  };
}

function collectGroups(
  groupsBySender: ReadonlyMap<string, ReadonlyMap<string | null, ReviewGroup>>,
): ReviewGroup[] {
  const groups: ReviewGroup[] = [];
  for (const groupsByTemplate of groupsBySender.values()) {
    for (const group of groupsByTemplate.values()) {
      groups.push(group);
    }
  }
  return groups;
}

function compareGroups(left: ReviewGroup, right: ReviewGroup): number {
  if (left.pending !== right.pending) {
    return right.pending - left.pending;
  }
  if (left.total !== right.total) {
    return right.total - left.total;
  }
  const senderOrder = compareText(left.fromAddress, right.fromAddress);
  if (senderOrder !== 0) {
    return senderOrder;
  }
  return compareText(
    left.templateFingerprint ?? '',
    right.templateFingerprint ?? '',
  );
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
