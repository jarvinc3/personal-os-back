import type { ModuleSettingsReader } from '@personal-os/contracts';
import type { Prisma, PrismaService } from '@personal-os/database';
import type { ReviewGroupsQueryDto } from './dto/review-groups-query.dto';
import type { ReviewQueueQueryDto } from './dto/review-queue-query.dto';
import { loadEmailReviewSettings } from '../email/email-review-settings';
import { normalizeSender } from '../knowledge/knowledge-normalizer';
import type { EmailEvidenceDataset } from './email-evidence-dataset';
import {
  EMAIL_SOURCE_TYPE,
  REVIEW_TARGET_TYPE,
} from './email-evidence.constants';
import {
  REVIEW_GROUPS_DEFAULT_ORDER,
  REVIEW_GROUPS_DEFAULT_PAGE_SIZE,
  REVIEW_GROUP_SAMPLE_SUBJECTS,
} from './review-groups.constants';
import { groupReviewMessages } from './review-groups.util';
import {
  isKnownSender,
  reviewGroupImpactKey,
  sortReviewGroupsByImpact,
  sortReviewQueueByImpact,
} from './review-impact.util';
import {
  REVIEW_QUEUE_DEFAULT_ORDER,
  REVIEW_QUEUE_PAGE_SIZE,
  REVIEW_QUEUE_RESOLVED_PROCESSING_STATUSES,
} from './review-queue.constants';
import {
  assertReviewQueueConfidenceRange,
  assertReviewQueueDateRange,
  decodeReviewImpactCursor,
  encodeReviewImpactCursor,
  encodeReviewQueueCursor,
  latestReviewVerifications,
  reviewQueueItems,
  reviewQueueMessageFilter,
  reviewQueueMessageSearchFilter,
  reviewQueuePendingCounts,
  reviewQueueReceivedAtFilter,
  reviewQueueSortDirection,
} from './review-queue.util';

type EmailReviewQueueReaderDependencies = {
  prisma: PrismaService;
  dataset: EmailEvidenceDataset;
  moduleSettings?: ModuleSettingsReader;
};

/** Lee la revisión pendiente: la cola paginada y los grupos por remitente. */
export class EmailReviewQueueReader {
  private readonly prisma: PrismaService;
  private readonly dataset: EmailEvidenceDataset;
  private readonly moduleSettings?: ModuleSettingsReader;

  constructor({
    prisma,
    dataset,
    moduleSettings,
  }: EmailReviewQueueReaderDependencies) {
    this.prisma = prisma;
    this.dataset = dataset;
    this.moduleSettings = moduleSettings;
  }

  async reviewQueue(userId: string, query: ReviewQueueQueryDto = {}) {
    assertReviewQueueDateRange(query.dateFrom, query.dateTo);
    assertReviewQueueConfidenceRange(query.confidenceMin, query.confidenceMax);
    const reviewSettings = await loadEmailReviewSettings(
      this.moduleSettings,
      userId,
    );
    const order = query.order ?? REVIEW_QUEUE_DEFAULT_ORDER;
    const dataset = await this.dataset.ensure();
    await this.dataset.ensureItems(userId, dataset.id);
    const [timezone, verifications, datasetItems, resolvedMessages] =
      await Promise.all([
        this.reviewQueueTimezone(userId, query),
        this.prisma.aiHumanVerification.findMany({
          where: { userId, targetType: REVIEW_TARGET_TYPE },
          orderBy: [{ targetId: 'asc' }, { sequence: 'desc' }],
          distinct: ['targetId'],
          select: {
            targetId: true,
            sequence: true,
            verdict: true,
            correctedPayload: true,
            notes: true,
            createdAt: true,
          },
        }),
        this.prisma.aiDatasetItem.findMany({
          where: {
            datasetId: dataset.id,
            userId,
            sourceType: EMAIL_SOURCE_TYPE,
          },
          select: { sourceId: true, partition: true },
        }),
        this.prisma.aiEmailMessage.findMany({
          where: {
            userId,
            processingStatus: {
              in: [...REVIEW_QUEUE_RESOLVED_PROCESSING_STATUSES],
            },
          },
          select: { id: true },
        }),
      ]);
    const latestByMessageId = latestReviewVerifications(verifications);
    const partitionByMessageId = new Map(
      datasetItems.map((item) => [item.sourceId, item.partition]),
    );
    const holdoutMessageIds = datasetItems
      .filter((item) => item.partition === 'HOLDOUT')
      .map(({ sourceId }) => sourceId);
    const nonHoldoutMessageIds = datasetItems
      .filter((item) => item.partition !== 'HOLDOUT')
      .map(({ sourceId }) => sourceId);
    const receivedAt = reviewQueueReceivedAtFilter({
      timezone,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
    const searchFilter = reviewQueueMessageSearchFilter({
      fromAddress: query.fromAddress,
      subject: query.subject,
      receivedAt,
    });
    const hasMatchingFilters =
      Object.keys(searchFilter).length > 0 ||
      query.semanticType !== undefined ||
      query.route !== undefined ||
      query.confidenceMin !== undefined ||
      query.confidenceMax !== undefined ||
      query.uncertain === true;
    const matchingMessageIds = hasMatchingFilters
      ? new Set(
          (
            await this.prisma.aiEmailMessage.findMany({
              where: reviewQueueMessageFilter({
                userId,
                latestByMessageId,
                skipStatusFilter: true,
                fromAddress: query.fromAddress,
                subject: query.subject,
                receivedAt,
                order: 'OLDEST',
                uncertain: query.uncertain,
                semanticType: query.semanticType,
                route: query.route,
                confidenceMin: query.confidenceMin,
                confidenceMax: query.confidenceMax,
                confidenceThreshold: reviewSettings.reviewConfidenceThreshold,
                holdoutMessageIds,
                nonHoldoutMessageIds,
              }),
              select: { id: true },
            })
          ).map(({ id }) => id),
        )
      : undefined;
    const counts = reviewQueuePendingCounts({
      items: datasetItems,
      reviewedMessageIds: [...latestByMessageId.keys()],
      matchingMessageIds,
      resolvedMessageIds: new Set(resolvedMessages.map(({ id }) => id)),
    });
    const partitionMessageIds = query.partition
      ? datasetItems
          .filter((item) => item.partition === query.partition)
          .map((item) => item.sourceId)
      : undefined;
    const where = reviewQueueMessageFilter({
      userId,
      latestByMessageId,
      statuses: query.status,
      partitionMessageIds,
      fromAddress: query.fromAddress,
      subject: query.subject,
      receivedAt,
      cursor: query.cursor,
      order,
      uncertain: query.uncertain,
      semanticType: query.semanticType,
      route: query.route,
      confidenceMin: query.confidenceMin,
      confidenceMax: query.confidenceMax,
      confidenceThreshold: reviewSettings.reviewConfidenceThreshold,
      holdoutMessageIds,
      nonHoldoutMessageIds,
    });
    const messageSelect = {
      id: true,
      receivedAt: true,
      fromAddress: true,
      fromDomain: true,
      subject: true,
      contentFingerprint: true,
      processingStatus: true,
      classification: true,
      templateFingerprint: true,
    } as const;
    let pageMessages: Array<{
      id: string;
      receivedAt: Date;
      fromAddress: string;
      fromDomain: string;
      subject: string;
      contentFingerprint: string;
      processingStatus: string;
      classification: Prisma.JsonValue | null;
      templateFingerprint: string | null;
    }>;
    let hasMore: boolean;
    let nextCursor: string | null;
    if (order === 'IMPACT') {
      const messages = await this.prisma.aiEmailMessage.findMany({
        where,
        orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
        select: messageSelect,
      });
      const knownSenders = await this.knownSenders(
        userId,
        messages.map(({ fromAddress }) => fromAddress),
      );
      const pendingByGroup = new Map<string, number>();
      for (const message of messages) {
        const key = reviewGroupImpactKey(
          message.fromAddress,
          message.templateFingerprint,
        );
        pendingByGroup.set(key, (pendingByGroup.get(key) ?? 0) + 1);
      }
      const prioritized = sortReviewQueueByImpact(
        messages.map((message) => ({
          ...message,
          pendingInGroup:
            pendingByGroup.get(
              reviewGroupImpactKey(
                message.fromAddress,
                message.templateFingerprint,
              ),
            ) ?? 0,
          senderKnown: isKnownSender(message.fromAddress, knownSenders),
          confidence: classificationConfidence(message.classification),
        })),
      );
      let start = 0;
      if (query.cursor) {
        const { nextId, fallbackIndex } = decodeReviewImpactCursor(
          query.cursor,
        );
        const nextIndex = prioritized.findIndex(({ id }) => id === nextId);
        start =
          nextIndex >= 0
            ? nextIndex
            : Math.min(fallbackIndex, prioritized.length);
      }
      hasMore = prioritized.length > start + REVIEW_QUEUE_PAGE_SIZE;
      pageMessages = prioritized
        .slice(start, start + REVIEW_QUEUE_PAGE_SIZE)
        .map(({ pendingInGroup, senderKnown, confidence, ...message }) => {
          void pendingInGroup;
          void senderKnown;
          void confidence;
          return message;
        });
      const nextPageFirst = prioritized[start + REVIEW_QUEUE_PAGE_SIZE];
      nextCursor =
        hasMore && nextPageFirst
          ? encodeReviewImpactCursor({
              nextId: nextPageFirst.id,
              fallbackIndex: start + REVIEW_QUEUE_PAGE_SIZE,
            })
          : null;
    } else {
      const direction = reviewQueueSortDirection(order);
      const messages = await this.prisma.aiEmailMessage.findMany({
        where,
        orderBy: [{ receivedAt: direction }, { id: direction }],
        take: REVIEW_QUEUE_PAGE_SIZE + 1,
        select: messageSelect,
      });
      hasMore = messages.length > REVIEW_QUEUE_PAGE_SIZE;
      pageMessages = hasMore
        ? messages.slice(0, REVIEW_QUEUE_PAGE_SIZE)
        : messages;
      const last = pageMessages.at(-1);
      nextCursor =
        hasMore && last
          ? encodeReviewQueueCursor({
              id: last.id,
              receivedAt: last.receivedAt,
            })
          : null;
    }
    const items = reviewQueueItems({
      messages: pageMessages,
      partitionByMessageId,
      latestByMessageId,
    });
    return {
      items,
      counts,
      hasMore,
      nextCursor,
    };
  }

  async listReviewGroups(userId: string, query: ReviewGroupsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? REVIEW_GROUPS_DEFAULT_PAGE_SIZE;
    const order = query.order ?? REVIEW_GROUPS_DEFAULT_ORDER;
    const dataset = await this.dataset.ensure();
    await this.dataset.ensureItems(userId, dataset.id);
    const [items, reviewed, messages] = await Promise.all([
      this.prisma.aiDatasetItem.findMany({
        where: { datasetId: dataset.id, userId, sourceType: EMAIL_SOURCE_TYPE },
        select: { sourceId: true, partition: true },
      }),
      this.prisma.aiHumanVerification.findMany({
        where: { userId, targetType: REVIEW_TARGET_TYPE },
        distinct: ['targetId'],
        select: { targetId: true },
      }),
      this.prisma.aiEmailMessage.findMany({
        where: { userId },
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          fromAddress: true,
          subject: true,
          templateFingerprint: true,
          classification: true,
        },
      }),
    ]);
    const reviewedMessageIds = new Set(
      reviewed.flatMap(({ targetId }) => (targetId ? [targetId] : [])),
    );
    const partitionByMessageId = new Map(
      items.map(({ sourceId, partition }) => [sourceId, partition]),
    );
    const groups = groupReviewMessages({
      messages,
      partitionByMessageId,
      reviewedMessageIds,
      sampleSize: REVIEW_GROUP_SAMPLE_SUBJECTS,
    }).filter(({ pending }) => pending > 0);
    const knownSenders = await this.knownSenders(
      userId,
      groups.map(({ fromAddress }) => fromAddress),
    );
    const confidenceTotals = new Map<
      string,
      { total: number; count: number }
    >();
    for (const message of messages) {
      if (
        reviewedMessageIds.has(message.id) ||
        !partitionByMessageId.has(message.id)
      ) {
        continue;
      }
      const confidence = classificationConfidence(message.classification);
      if (confidence === null) {
        continue;
      }
      const key = reviewGroupImpactKey(
        message.fromAddress,
        message.templateFingerprint,
      );
      const current = confidenceTotals.get(key) ?? { total: 0, count: 0 };
      current.total += confidence;
      current.count += 1;
      confidenceTotals.set(key, current);
    }
    const confidenceByGroup = new Map(
      [...confidenceTotals].map(([key, confidence]) => [
        key,
        confidence.total / confidence.count,
      ]),
    );
    const orderedGroups =
      order === 'IMPACT'
        ? sortReviewGroupsByImpact(groups, {
            knownSenders,
            confidenceByGroup,
          })
        : groups;
    const start = (page - 1) * pageSize;
    return {
      items: orderedGroups.slice(start, start + pageSize),
      page,
      pageSize,
      totalGroups: orderedGroups.length,
      hasMore: start + pageSize < orderedGroups.length,
    };
  }

  private async knownSenders(
    userId: string,
    senderAddresses: readonly string[],
  ): Promise<Set<string>> {
    const senderKeys = [
      ...new Set(
        senderAddresses.flatMap((address) => {
          const normalized = normalizeSender(address);
          return normalized ? [normalized] : [];
        }),
      ),
    ];
    if (!senderKeys.length) {
      return new Set();
    }
    const rows = await this.prisma.aiKnowledge.findMany({
      where: {
        userId,
        scope: 'USER',
        state: 'STABLE',
        knowledgeType: 'EMAIL_SENDER',
        knowledgeKey: { in: senderKeys },
      },
      select: { knowledgeKey: true },
    });
    return new Set(rows.map(({ knowledgeKey }) => knowledgeKey));
  }

  private async reviewQueueTimezone(
    userId: string,
    query: ReviewQueueQueryDto,
  ): Promise<string | null> {
    if (!query.dateFrom && !query.dateTo) {
      return null;
    }
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return profile?.timezone ?? null;
  }
}

function classificationConfidence(value: unknown): number | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('confidence' in value)
  ) {
    return null;
  }
  const confidence = value.confidence;
  return typeof confidence === 'number' && Number.isFinite(confidence)
    ? confidence
    : null;
}
