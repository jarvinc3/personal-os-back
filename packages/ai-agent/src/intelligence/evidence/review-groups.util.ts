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
};

type ReviewGroupInput = {
  messages: readonly ReviewGroupMessage[];
  partitionByMessageId: ReadonlyMap<string, EmailDatasetPartition>;
  reviewedMessageIds: ReadonlySet<string>;
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
    const group = findOrCreateGroup(groupsBySender, message);
    group.total += 1;
    if (
      group.sampleSubjects.length < sampleSize &&
      !group.sampleSubjects.includes(message.subject)
    ) {
      group.sampleSubjects.push(message.subject);
    }
    if (reviewedMessageIds.has(message.id)) {
      continue;
    }
    group.pending += 1;
    if (partition === 'HOLDOUT') {
      group.pendingHoldout += 1;
    }
  }
  return flattenGroups(groupsBySender).sort(compareGroups);
}

function findOrCreateGroup(
  groupsBySender: Map<string, Map<string | null, ReviewGroup>>,
  message: ReviewGroupMessage,
): ReviewGroup {
  const groupsByTemplate =
    groupsBySender.get(message.fromAddress) ??
    new Map<string | null, ReviewGroup>();
  groupsBySender.set(message.fromAddress, groupsByTemplate);
  const existing = groupsByTemplate.get(message.templateFingerprint);
  if (existing) {
    return existing;
  }
  const created: ReviewGroup = {
    fromAddress: message.fromAddress,
    templateFingerprint: message.templateFingerprint,
    total: 0,
    pending: 0,
    pendingHoldout: 0,
    sampleSubjects: [],
  };
  groupsByTemplate.set(message.templateFingerprint, created);
  return created;
}

function flattenGroups(
  groupsBySender: Map<string, Map<string | null, ReviewGroup>>,
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
