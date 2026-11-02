import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { fromZonedTime } from 'date-fns-tz';
import type { HumanVerificationVerdict } from './human-verification.constants';
import {
  REVIEW_QUEUE_PENDING_STATUS,
  type ReviewQueueOrder,
  type ReviewQueuePartition,
  type ReviewQueueStatus,
} from './review-queue.constants';

export type ReviewQueueVerificationRow = {
  targetId: string | null;
  sequence: bigint;
  verdict: HumanVerificationVerdict;
  correctedPayload: Prisma.JsonValue | null;
  notes: string | null;
  createdAt: Date;
};

export type LatestReviewVerification = Omit<
  ReviewQueueVerificationRow,
  'targetId'
> & {
  targetId: string;
};

export type ReviewQueueItemVerification = {
  verdict: HumanVerificationVerdict;
  labels: Record<string, unknown> | null;
  notes: string | null;
  createdAt: string;
};

export type ReviewQueueMessageRow = {
  id: string;
  receivedAt: Date;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  contentFingerprint: string;
  processingStatus: string;
};

export type ReviewQueueItem = ReviewQueueMessageRow & {
  partition: ReviewQueuePartition;
  status: ReviewQueueStatus;
  verification: ReviewQueueItemVerification | null;
};

const INVALID_CURSOR_MESSAGE = 'Cursor de revisión inválido';
const INVERTED_RANGE_MESSAGE = 'El rango de fechas está invertido';

/** `?status=A,B` or repeated `status=A&status=B`, trimmed and deduplicated. */
export function toReviewQueueStatusList(value: unknown): string[] | undefined {
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const cleaned = entries
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);
  const distinct = [...new Set(cleaned)];
  return distinct.length ? distinct : undefined;
}

export function assertReviewQueueDateRange(
  dateFrom?: string,
  dateTo?: string,
): void {
  if (!dateFrom || !dateTo) {
    return;
  }
  if (dateFrom > dateTo) {
    throw new BadRequestException(INVERTED_RANGE_MESSAGE);
  }
}

/**
 * Inclusive first day and exclusive day after the last one, both read as
 * midnight in the account's timezone so a picked day covers its 24 local hours.
 */
export function reviewQueueReceivedAtFilter({
  timezone,
  dateFrom,
  dateTo,
}: {
  timezone: string | null;
  dateFrom?: string;
  dateTo?: string;
}): Prisma.DateTimeFilter | undefined {
  if (!dateFrom && !dateTo) {
    return undefined;
  }
  const zone = timezone ?? 'UTC';
  return {
    ...(dateFrom ? { gte: zonedDayStart(dateFrom, zone) } : {}),
    ...(dateTo ? { lt: zonedDayStart(addIsoDays(dateTo, 1), zone) } : {}),
  };
}

export function latestReviewVerifications(
  rows: readonly ReviewQueueVerificationRow[],
): Map<string, LatestReviewVerification> {
  const latest = new Map<string, LatestReviewVerification>();
  for (const row of rows) {
    if (!row.targetId) {
      continue;
    }
    const current = latest.get(row.targetId);
    if (current && current.sequence >= row.sequence) {
      continue;
    }
    latest.set(row.targetId, { ...row, targetId: row.targetId });
  }
  return latest;
}

export function reviewQueueItemVerification(
  verification: LatestReviewVerification,
): ReviewQueueItemVerification {
  return {
    verdict: verification.verdict,
    labels: reviewQueueLabels(verification.correctedPayload),
    notes: verification.notes,
    createdAt: verification.createdAt.toISOString(),
  };
}

export function reviewQueueItems({
  messages,
  partitionByMessageId,
  latestByMessageId,
}: {
  messages: readonly ReviewQueueMessageRow[];
  partitionByMessageId: ReadonlyMap<string, ReviewQueuePartition>;
  latestByMessageId: ReadonlyMap<string, LatestReviewVerification>;
}): ReviewQueueItem[] {
  return messages.flatMap((message) => {
    const partition = partitionByMessageId.get(message.id);
    if (!partition) {
      return [];
    }
    const verification = latestByMessageId.get(message.id);
    return [
      {
        ...message,
        partition,
        status: verification?.verdict ?? REVIEW_QUEUE_PENDING_STATUS,
        verification: verification
          ? reviewQueueItemVerification(verification)
          : null,
      },
    ];
  });
}

export function reviewQueueMessageSearchFilter({
  fromAddress,
  subject,
  receivedAt,
}: {
  fromAddress?: string;
  subject?: string;
  receivedAt?: Prisma.DateTimeFilter;
}): Prisma.AiEmailMessageWhereInput {
  return {
    ...(fromAddress
      ? { fromAddress: { equals: fromAddress, mode: 'insensitive' } }
      : {}),
    ...(subject ? { subject: { contains: subject, mode: 'insensitive' } } : {}),
    ...(receivedAt ? { receivedAt } : {}),
  };
}

export function reviewQueueMessageFilter({
  userId,
  latestByMessageId,
  statuses,
  partitionMessageIds,
  fromAddress,
  subject,
  receivedAt,
  cursor,
  order,
}: {
  userId: string;
  latestByMessageId: ReadonlyMap<string, LatestReviewVerification>;
  statuses?: readonly ReviewQueueStatus[];
  partitionMessageIds?: readonly string[];
  fromAddress?: string;
  subject?: string;
  receivedAt?: Prisma.DateTimeFilter;
  cursor?: string;
  order: ReviewQueueOrder;
}): Prisma.AiEmailMessageWhereInput {
  const clauses = [
    reviewQueueStatusFilter({ statuses, latestByMessageId }),
    reviewQueueCursorFilter({ cursor, order }),
  ].filter(
    (clause): clause is Prisma.AiEmailMessageWhereInput => clause !== undefined,
  );
  return {
    userId,
    ...(partitionMessageIds ? { id: { in: [...partitionMessageIds] } } : {}),
    ...reviewQueueMessageSearchFilter({ fromAddress, subject, receivedAt }),
    ...(clauses.length ? { AND: clauses } : {}),
  };
}

export type ReviewQueueCounts = {
  all: number;
  TRAIN: number;
  VALIDATION: number;
  HOLDOUT: number;
};

/** Cuenta los pendientes por partición, ya filtrados por la búsqueda. */
export function reviewQueuePendingCounts({
  items,
  reviewedMessageIds,
  matchingMessageIds,
}: {
  items: readonly {
    sourceId: string;
    partition: ReviewQueuePartition;
  }[];
  reviewedMessageIds: readonly string[];
  matchingMessageIds?: ReadonlySet<string>;
}): ReviewQueueCounts {
  const reviewed = new Set(reviewedMessageIds);
  const counts = { TRAIN: 0, VALIDATION: 0, HOLDOUT: 0 };
  for (const item of items) {
    if (reviewed.has(item.sourceId)) {
      continue;
    }
    if (matchingMessageIds && !matchingMessageIds.has(item.sourceId)) {
      continue;
    }
    counts[item.partition] += 1;
  }
  return {
    ...counts,
    all: counts.TRAIN + counts.VALIDATION + counts.HOLDOUT,
  };
}

export function reviewQueueSortDirection(
  order: ReviewQueueOrder,
): 'asc' | 'desc' {
  return order === 'NEWEST' ? 'desc' : 'asc';
}

export function encodeReviewQueueCursor({
  id,
  receivedAt,
}: {
  id: string;
  receivedAt: Date;
}): string {
  return encodeCursor({ key: receivedAt.toISOString(), id });
}

function reviewQueueStatusFilter({
  statuses,
  latestByMessageId,
}: {
  statuses?: readonly ReviewQueueStatus[];
  latestByMessageId: ReadonlyMap<string, LatestReviewVerification>;
}): Prisma.AiEmailMessageWhereInput | undefined {
  const selected =
    statuses && statuses.length ? statuses : [REVIEW_QUEUE_PENDING_STATUS];
  const includesPending = selected.includes(REVIEW_QUEUE_PENDING_STATUS);
  const verdicts = selected.filter(
    (status) => status !== REVIEW_QUEUE_PENDING_STATUS,
  );
  const reviewedMessageIds = [...latestByMessageId.keys()];
  if (!verdicts.length) {
    if (!reviewedMessageIds.length) {
      return undefined;
    }
    return { id: { notIn: reviewedMessageIds } };
  }
  const verdictMessageIds = [...latestByMessageId.values()]
    .filter((verification) => verdicts.includes(verification.verdict))
    .map((verification) => verification.targetId);
  if (!includesPending) {
    return { id: { in: verdictMessageIds } };
  }
  return {
    OR: [
      { id: { notIn: reviewedMessageIds } },
      { id: { in: verdictMessageIds } },
    ],
  };
}

function reviewQueueCursorFilter({
  cursor,
  order,
}: {
  cursor?: string;
  order: ReviewQueueOrder;
}): Prisma.AiEmailMessageWhereInput | undefined {
  if (!cursor) {
    return undefined;
  }
  const { key, id } = decodeReviewQueueCursor(cursor);
  const receivedAt = new Date(key);
  if (order === 'NEWEST') {
    return {
      OR: [{ receivedAt: { lt: receivedAt } }, { receivedAt, id: { lt: id } }],
    };
  }
  return {
    OR: [{ receivedAt: { gt: receivedAt } }, { receivedAt, id: { gt: id } }],
  };
}

function decodeReviewQueueCursor(cursor: string): { key: string; id: string } {
  try {
    return decodeCursor(cursor);
  } catch (error) {
    throw new BadRequestException(INVALID_CURSOR_MESSAGE, { cause: error });
  }
}

function reviewQueueLabels(
  payload: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return null;
  }
  return payload;
}

function zonedDayStart(day: string, timeZone: string): Date {
  return fromZonedTime(`${day}T00:00:00.000`, timeZone);
}

function addIsoDays(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
