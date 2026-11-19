import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { fromZonedTime } from 'date-fns-tz';
import {
  SEMANTIC_ROUTES,
  SEMANTIC_TYPES,
  type HumanVerificationVerdict,
  type SemanticRoute,
  type SemanticType,
} from './human-verification.constants';
import {
  REVIEW_QUEUE_PENDING_STATUS,
  REVIEW_QUEUE_RESOLVED_PROCESSING_STATUSES,
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
  classification?: Prisma.JsonValue | null;
  templateFingerprint?: string | null;
};

export type ReviewQueueItem = ReviewQueueMessageRow & {
  partition: ReviewQueuePartition;
  status: ReviewQueueStatus;
  verification: ReviewQueueItemVerification | null;
  semanticType: SemanticType | null;
  routes: SemanticRoute[];
  confidence: number | null;
};

const INVALID_CURSOR_MESSAGE = 'Cursor de revisión inválido';
const INVERTED_RANGE_MESSAGE = 'El rango de fechas está invertido';
const INVERTED_CONFIDENCE_RANGE_MESSAGE =
  'El rango de confianza está invertido';

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

export function assertReviewQueueConfidenceRange(
  confidenceMin?: number,
  confidenceMax?: number,
): void {
  if (
    confidenceMin !== undefined &&
    confidenceMax !== undefined &&
    confidenceMin > confidenceMax
  ) {
    throw new BadRequestException(INVERTED_CONFIDENCE_RANGE_MESSAGE);
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
    const baseMessage = {
      id: message.id,
      receivedAt: message.receivedAt,
      fromAddress: message.fromAddress,
      fromDomain: message.fromDomain,
      subject: message.subject,
      contentFingerprint: message.contentFingerprint,
      processingStatus: message.processingStatus,
    };
    return [
      {
        ...baseMessage,
        partition,
        status: verification?.verdict ?? REVIEW_QUEUE_PENDING_STATUS,
        verification: verification
          ? reviewQueueItemVerification(verification)
          : null,
        ...reviewQueueClassificationFields(message.classification),
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
  skipStatusFilter,
  partitionMessageIds,
  fromAddress,
  subject,
  receivedAt,
  cursor,
  order,
  uncertain,
  semanticType,
  route,
  confidenceMin,
  confidenceMax,
  confidenceThreshold = 0.7,
  holdoutMessageIds,
  nonHoldoutMessageIds,
}: {
  userId: string;
  latestByMessageId: ReadonlyMap<string, LatestReviewVerification>;
  statuses?: readonly ReviewQueueStatus[];
  skipStatusFilter?: boolean;
  partitionMessageIds?: readonly string[];
  fromAddress?: string;
  subject?: string;
  receivedAt?: Prisma.DateTimeFilter;
  cursor?: string;
  order: ReviewQueueOrder;
  uncertain?: boolean;
  semanticType?: SemanticType;
  route?: SemanticRoute;
  confidenceMin?: number;
  confidenceMax?: number;
  confidenceThreshold?: number;
  holdoutMessageIds?: readonly string[];
  nonHoldoutMessageIds?: readonly string[];
}): Prisma.AiEmailMessageWhereInput {
  const clauses = [
    ...(skipStatusFilter
      ? []
      : [reviewQueueStatusFilter({ statuses, latestByMessageId })]),
    reviewQueueCursorFilter({ cursor, order }),
  ].filter(
    (clause): clause is Prisma.AiEmailMessageWhereInput => clause !== undefined,
  );
  const classificationFilter = {
    ...(semanticType ? { semanticType } : {}),
    ...(route ? { route } : {}),
    ...(confidenceMin !== undefined || confidenceMax !== undefined
      ? {
          confidence: {
            ...(confidenceMin !== undefined ? { gte: confidenceMin } : {}),
            ...(confidenceMax !== undefined ? { lte: confidenceMax } : {}),
          },
        }
      : {}),
  };
  if (Object.keys(classificationFilter).length) {
    clauses.push({ classifications: { some: classificationFilter } });
  }
  if (uncertain) {
    const partitionAware =
      holdoutMessageIds !== undefined && nonHoldoutMessageIds !== undefined;
    clauses.push({
      OR: [
        { classifications: { none: {} } },
        ...(partitionAware && nonHoldoutMessageIds.length
          ? [
              {
                id: { in: [...nonHoldoutMessageIds] },
                classifications: {
                  some: { confidence: { lt: confidenceThreshold } },
                },
              },
            ]
          : []),
        ...(partitionAware && holdoutMessageIds.length
          ? [
              {
                id: { in: [...holdoutMessageIds] },
                classifications: {
                  some: { confidence: { lt: 0.7 } },
                },
              },
            ]
          : []),
        ...(!partitionAware
          ? [
              {
                classifications: {
                  some: { confidence: { lt: confidenceThreshold } },
                },
              },
            ]
          : []),
      ],
    });
  }
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
  resolvedMessageIds,
}: {
  items: readonly {
    sourceId: string;
    partition: ReviewQueuePartition;
  }[];
  reviewedMessageIds: readonly string[];
  matchingMessageIds?: ReadonlySet<string>;
  resolvedMessageIds?: ReadonlySet<string>;
}): ReviewQueueCounts {
  const reviewed = new Set(reviewedMessageIds);
  const counts = { TRAIN: 0, VALIDATION: 0, HOLDOUT: 0 };
  for (const item of items) {
    if (reviewed.has(item.sourceId)) {
      continue;
    }
    if (resolvedMessageIds?.has(item.sourceId)) {
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

export type ReviewImpactCursor = {
  nextId: string;
  fallbackIndex: number;
};

const IMPACT_CURSOR_PREFIX = 'IMPACT';
const IMPACT_CURSOR_KEY = new RegExp(`^${IMPACT_CURSOR_PREFIX}:(\\d+)$`);

export function encodeReviewImpactCursor({
  nextId,
  fallbackIndex,
}: ReviewImpactCursor): string {
  return encodeCursor({
    key: `${IMPACT_CURSOR_PREFIX}:${fallbackIndex}`,
    id: nextId,
  });
}

export function decodeReviewImpactCursor(cursor: string): ReviewImpactCursor {
  const decoded = decodeReviewQueueCursor(cursor, (key) =>
    IMPACT_CURSOR_KEY.test(key),
  );
  const match = IMPACT_CURSOR_KEY.exec(decoded.key);
  const fallbackIndex = match ? Number(match[1]) : Number.NaN;
  if (
    !match ||
    !decoded.id ||
    !Number.isSafeInteger(fallbackIndex) ||
    fallbackIndex < 0
  ) {
    throw new BadRequestException(INVALID_CURSOR_MESSAGE);
  }
  return { nextId: decoded.id, fallbackIndex };
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
  const pendingFilter: Prisma.AiEmailMessageWhereInput = {
    processingStatus: { notIn: [...REVIEW_QUEUE_RESOLVED_PROCESSING_STATUSES] },
    ...(reviewedMessageIds.length ? { id: { notIn: reviewedMessageIds } } : {}),
  };
  if (!verdicts.length) {
    return pendingFilter;
  }
  const verdictMessageIds = [...latestByMessageId.values()]
    .filter((verification) => verdicts.includes(verification.verdict))
    .map((verification) => verification.targetId);
  if (!includesPending) {
    return { id: { in: verdictMessageIds } };
  }
  return {
    OR: [pendingFilter, { id: { in: verdictMessageIds } }],
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
  if (order === 'IMPACT') {
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

function decodeReviewQueueCursor(
  cursor: string,
  isValidKey?: (key: string) => boolean,
): { key: string; id: string } {
  try {
    return decodeCursor(cursor, isValidKey);
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

function reviewQueueClassificationFields(value: unknown): {
  semanticType: SemanticType | null;
  routes: SemanticRoute[];
  confidence: number | null;
} {
  if (!isRecord(value)) {
    return { semanticType: null, routes: [], confidence: null };
  }
  return {
    semanticType: SEMANTIC_TYPES.includes(value.semanticType as SemanticType)
      ? (value.semanticType as SemanticType)
      : null,
    routes: Array.isArray(value.routes)
      ? value.routes.filter((route): route is SemanticRoute =>
          SEMANTIC_ROUTES.includes(route as SemanticRoute),
        )
      : [],
    confidence:
      typeof value.confidence === 'number' && Number.isFinite(value.confidence)
        ? value.confidence
        : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function zonedDayStart(day: string, timeZone: string): Date {
  return fromZonedTime(`${day}T00:00:00.000`, timeZone);
}

function addIsoDays(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
