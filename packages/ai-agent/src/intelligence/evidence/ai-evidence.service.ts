import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@personal-os/database';
import type { CreateHumanVerificationDto } from './dto/create-human-verification.dto';
import type { CreateReviewGroupVerificationDto } from './dto/create-review-group-verification.dto';
import type { ReviewGroupsQueryDto } from './dto/review-groups-query.dto';
import type { ReviewQueueQueryDto } from './dto/review-queue-query.dto';
import { partitionEmailDatasetItem } from './dataset-partition.util';
import {
  assertHumanVerificationLabels,
  humanVerificationPayload,
} from './human-verification.validation';
import {
  REVIEW_GROUPS_DEFAULT_PAGE_SIZE,
  REVIEW_GROUP_SAMPLE_SUBJECTS,
} from './review-groups.constants';
import {
  REVIEW_QUEUE_DEFAULT_ORDER,
  REVIEW_QUEUE_PAGE_SIZE,
  REVIEW_QUEUE_PENDING_STATUS,
} from './review-queue.constants';
import {
  assertReviewQueueDateRange,
  encodeReviewQueueCursor,
  latestReviewVerifications,
  reviewQueueItemVerification,
  reviewQueueMessageFilter,
  reviewQueueReceivedAtFilter,
  reviewQueueSortDirection,
} from './review-queue.util';
import { groupReviewMessages } from './review-groups.util';
import { PROJECTOR_VERSION } from '../knowledge/knowledge-projector';
import { POLICY_VERSION } from '../knowledge/knowledge-policy';

import { EMAIL_DATASET_NAME, EMAIL_DATASET_PURPOSE } from './dataset.constants';

const EMAIL_SOURCE_TYPE = 'EMAIL_MESSAGE';
const REVIEW_TARGET_TYPE = 'EMAIL_MESSAGE';

@Injectable()
export class AiEvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async datasetSummary(userId: string) {
    const dataset = await this.ensureDataset();
    await this.ensureDatasetItems(userId, dataset.id);
    const counts = await this.prisma.aiDatasetItem.groupBy({
      by: ['partition'],
      where: { datasetId: dataset.id, userId },
      _count: { _all: true },
    });
    return {
      id: dataset.id,
      name: dataset.name,
      partitions: {
        TRAIN:
          counts.find((item) => item.partition === 'TRAIN')?._count._all ?? 0,
        VALIDATION:
          counts.find((item) => item.partition === 'VALIDATION')?._count._all ??
          0,
        HOLDOUT:
          counts.find((item) => item.partition === 'HOLDOUT')?._count._all ?? 0,
      },
    };
  }

  async reviewQueue(userId: string, query: ReviewQueueQueryDto = {}) {
    assertReviewQueueDateRange(query.dateFrom, query.dateTo);
    const order = query.order ?? REVIEW_QUEUE_DEFAULT_ORDER;
    const dataset = await this.ensureDataset();
    await this.ensureDatasetItems(userId, dataset.id);
    const [timezone, verifications, datasetItems] = await Promise.all([
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
        where: { datasetId: dataset.id, userId, sourceType: EMAIL_SOURCE_TYPE },
        select: { sourceId: true, partition: true },
      }),
    ]);
    const latestByMessageId = latestReviewVerifications(verifications);
    const partitionByMessageId = new Map(
      datasetItems.map((item) => [item.sourceId, item.partition]),
    );
    const partitionCounts = await this.pendingPartitionCounts({
      datasetId: dataset.id,
      userId,
      reviewedMessageIds: [...latestByMessageId.keys()],
    });
    const partitionMessageIds = query.partition
      ? datasetItems
          .filter((item) => item.partition === query.partition)
          .map((item) => item.sourceId)
      : undefined;
    const direction = reviewQueueSortDirection(order);
    const messages = await this.prisma.aiEmailMessage.findMany({
      where: reviewQueueMessageFilter({
        userId,
        latestByMessageId,
        statuses: query.status,
        partitionMessageIds,
        fromAddress: query.fromAddress,
        subject: query.subject,
        receivedAt: reviewQueueReceivedAtFilter({
          timezone,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
        }),
        cursor: query.cursor,
        order,
      }),
      orderBy: [{ receivedAt: direction }, { id: direction }],
      take: REVIEW_QUEUE_PAGE_SIZE + 1,
      select: {
        id: true,
        receivedAt: true,
        fromAddress: true,
        fromDomain: true,
        subject: true,
        contentFingerprint: true,
        processingStatus: true,
      },
    });
    const hasMore = messages.length > REVIEW_QUEUE_PAGE_SIZE;
    const pageMessages = hasMore
      ? messages.slice(0, REVIEW_QUEUE_PAGE_SIZE)
      : messages;
    const rows = pageMessages.flatMap((message) => {
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
    const counts = {
      TRAIN:
        partitionCounts.find((item) => item.partition === 'TRAIN')?._count
          ._all ?? 0,
      VALIDATION:
        partitionCounts.find((item) => item.partition === 'VALIDATION')?._count
          ._all ?? 0,
      HOLDOUT:
        partitionCounts.find((item) => item.partition === 'HOLDOUT')?._count
          ._all ?? 0,
    };
    const last = pageMessages.at(-1);
    return {
      items: rows,
      counts: {
        ...counts,
        all: counts.TRAIN + counts.VALIDATION + counts.HOLDOUT,
      },
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeReviewQueueCursor({
              id: last.id,
              receivedAt: last.receivedAt,
            })
          : null,
    };
  }

  async listReviewGroups(userId: string, query: ReviewGroupsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? REVIEW_GROUPS_DEFAULT_PAGE_SIZE;
    const dataset = await this.ensureDataset();
    await this.ensureDatasetItems(userId, dataset.id);
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
        },
      }),
    ]);
    const groups = groupReviewMessages({
      messages,
      partitionByMessageId: new Map(
        items.map(({ sourceId, partition }) => [sourceId, partition]),
      ),
      reviewedMessageIds: new Set(
        reviewed.flatMap(({ targetId }) => (targetId ? [targetId] : [])),
      ),
      sampleSize: REVIEW_GROUP_SAMPLE_SUBJECTS,
    }).filter(({ pending }) => pending > 0);
    const start = (page - 1) * pageSize;
    return {
      items: groups.slice(start, start + pageSize),
      page,
      pageSize,
      totalGroups: groups.length,
      hasMore: start + pageSize < groups.length,
    };
  }

  async verifyReviewGroup(
    userId: string,
    dto: CreateReviewGroupVerificationDto,
  ) {
    assertHumanVerificationLabels(dto);
    const dataset = await this.ensureDataset();
    await this.ensureDatasetItems(userId, dataset.id);
    const messages = await this.prisma.aiEmailMessage.findMany({
      where: {
        userId,
        fromAddress: dto.fromAddress,
        templateFingerprint: dto.templateFingerprint ?? null,
      },
      select: { id: true },
    });
    if (!messages.length) {
      throw new NotFoundException('Grupo de revisión no encontrado');
    }
    const messageIds = messages.map(({ id }) => id);
    const [items, roleAssignment] = await Promise.all([
      this.prisma.aiDatasetItem.findMany({
        where: {
          datasetId: dataset.id,
          userId,
          sourceType: EMAIL_SOURCE_TYPE,
          sourceId: { in: messageIds },
        },
        select: { sourceId: true, partition: true },
      }),
      this.prisma.userRole.findUnique({
        where: { userId },
        select: { role: true },
      }),
    ]);
    const partitionByMessageId = new Map(
      items.map(({ sourceId, partition }) => [sourceId, partition]),
    );
    const groupMessages = messages.flatMap(({ id }) => {
      const partition = partitionByMessageId.get(id);
      return partition ? [{ id, partition }] : [];
    });
    const verifierRole = roleAssignment?.role ?? 'USER';
    const correctedPayload = humanVerificationPayload(dto);
    const notes = dto.notes?.trim() || null;
    const groupKey = JSON.stringify([
      dto.fromAddress,
      dto.templateFingerprint ?? null,
    ]);
    return this.prisma.$transaction(async (tx) => {
      await lockReviewGroup(tx, { userId, groupKey });
      const verifications = await tx.aiHumanVerification.findMany({
        where: {
          userId,
          targetType: REVIEW_TARGET_TYPE,
          targetId: { in: groupMessages.map(({ id }) => id) },
        },
        distinct: ['targetId'],
        select: { targetId: true },
      });
      const verifiedMessageIds = new Set(
        verifications.flatMap(({ targetId }) => (targetId ? [targetId] : [])),
      );
      const pending = groupMessages.filter(
        ({ id, partition }) =>
          !verifiedMessageIds.has(id) && partition !== 'HOLDOUT',
      );
      const alreadyVerified = groupMessages.filter(({ id }) =>
        verifiedMessageIds.has(id),
      ).length;
      const holdoutExcluded = groupMessages.filter(
        ({ id, partition }) =>
          !verifiedMessageIds.has(id) && partition === 'HOLDOUT',
      ).length;
      if (pending.length) {
        await tx.aiHumanVerification.createMany({
          data: pending.map(({ id }) => ({
            userId,
            verifierRole,
            targetType: REVIEW_TARGET_TYPE,
            targetId: id,
            verdict: dto.verdict,
            correctedPayload: correctedPayload as never,
            notes,
            isGroundTruth: false,
          })),
        });
      }
      return {
        verified: pending.length,
        holdoutExcluded,
        alreadyVerified,
      };
    });
  }

  async verifyMessage(
    userId: string,
    messageId: string,
    dto: CreateHumanVerificationDto,
  ) {
    const dataset = await this.ensureDataset();
    await this.ensureDatasetItems(userId, dataset.id);
    const [message, item, roleAssignment] = await Promise.all([
      this.prisma.aiEmailMessage.findFirst({
        where: { id: messageId, userId },
        select: { id: true },
      }),
      this.prisma.aiDatasetItem.findFirst({
        where: {
          datasetId: dataset.id,
          userId,
          sourceType: EMAIL_SOURCE_TYPE,
          sourceId: messageId,
        },
        select: { partition: true },
      }),
      this.prisma.userRole.findUnique({
        where: { userId },
        select: { role: true },
      }),
    ]);
    if (!message || !item) {
      throw new NotFoundException('Mensaje no encontrado');
    }
    assertHumanVerificationLabels(dto);

    const correctedPayload = humanVerificationPayload(dto);
    const verification = await this.prisma.aiHumanVerification.create({
      data: {
        userId,
        verifierRole: roleAssignment?.role ?? 'USER',
        targetType: REVIEW_TARGET_TYPE,
        targetId: messageId,
        verdict: dto.verdict,
        correctedPayload: correctedPayload as never,
        notes: dto.notes?.trim() || null,
        isGroundTruth: item.partition === 'HOLDOUT',
      },
      select: {
        sequence: true,
        verifierRole: true,
        targetType: true,
        targetId: true,
        verdict: true,
        correctedPayload: true,
        notes: true,
        isGroundTruth: true,
        createdAt: true,
      },
    });
    return { ...verification, sequence: verification.sequence.toString() };
  }

  async startAnalysisRun(
    userId: string,
    mode: 'ANALYZE_ONLY' | 'EVALUATE' | 'IMPORT',
    configuration: Record<string, unknown>,
  ) {
    const dataset = await this.ensureDataset();
    await this.ensureDatasetItems(userId, dataset.id);
    return this.prisma.$transaction(
      async (tx) => {
        const [observationWatermark, verificationWatermark, consentWatermark] =
          await Promise.all([
            tx.aiKnowledgeObservation.aggregate({ _max: { sequence: true } }),
            tx.aiHumanVerification.aggregate({ _max: { sequence: true } }),
            tx.aiConsentEvent.aggregate({ _max: { sequence: true } }),
          ]);
        return tx.aiAnalysisRun.create({
          data: {
            userId,
            datasetId: dataset.id,
            mode,
            observationSequence: observationWatermark._max.sequence ?? 0n,
            verificationSequence: verificationWatermark._max.sequence ?? 0n,
            consentRevision: consentWatermark._max.sequence ?? 0n,
            reproductionStatus: 'COMPLETE',
            projectorVersion: PROJECTOR_VERSION,
            policyVersion: POLICY_VERSION,
            pipelineVersion: 'ai-pipeline-v1',
            detectorVersion: 'email-detector-v1',
            schemaVersion: 'ai-review-v1',
            configuration: {
              ...JSON.parse(JSON.stringify(configuration)),
              snapshot: 'REPEATABLE_READ',
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async completeAnalysisRun(
    userId: string,
    runId: string,
    outcome: { metrics?: Record<string, unknown>; error?: string },
  ) {
    const existing = await this.prisma.aiAnalysisRun.findFirst({
      where: { id: runId, userId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException('Run no encontrado');
    }
    if (existing.status !== 'RUNNING') {
      throw new BadRequestException('El run ya está cerrado');
    }
    return this.prisma.aiAnalysisRun.update({
      where: { id: runId },
      data: {
        status: outcome.error ? 'FAILED' : 'COMPLETED',
        completedAt: new Date(),
        ...(outcome.metrics
          ? { metrics: JSON.parse(JSON.stringify(outcome.metrics)) }
          : {}),
        ...(outcome.error ? { error: outcome.error.slice(0, 2_000) } : {}),
      },
    });
  }

  async recordObservation(input: {
    userId: string;
    runId?: string;
    knowledgeType: string;
    knowledgeKey: string;
    proposedScope: string;
    sourceType: string;
    sourceId: string;
    payload: Record<string, unknown>;
    weight?: number;
  }) {
    if (input.sourceType === EMAIL_SOURCE_TYPE) {
      const source = await this.prisma.aiEmailMessage.findFirst({
        where: { id: input.sourceId, userId: input.userId },
        select: { id: true },
      });
      if (!source) {
        throw new NotFoundException('Correo de origen no encontrado');
      }
    }
    if (input.runId) {
      const run = await this.prisma.aiAnalysisRun.findFirst({
        where: { id: input.runId, userId: input.userId },
        select: { id: true },
      });
      if (!run) {
        throw new NotFoundException('Run no encontrado');
      }
    }
    const observation = await this.prisma.aiKnowledgeObservation.create({
      data: {
        ...input,
        payload: JSON.parse(JSON.stringify(input.payload)),
      },
    });
    return { ...observation, sequence: observation.sequence.toString() };
  }

  async listRuns(userId: string) {
    const runs = await this.prisma.aiAnalysisRun.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        datasetId: true,
        mode: true,
        status: true,
        observationSequence: true,
        verificationSequence: true,
        consentRevision: true,
        reproductionStatus: true,
        missingEvidence: true,
        projectorVersion: true,
        policyVersion: true,
        pipelineVersion: true,
        detectorVersion: true,
        promptVersion: true,
        schemaVersion: true,
        configuration: true,
        metrics: true,
        startedAt: true,
        completedAt: true,
        error: true,
      },
    });
    return runs.map((run) => ({
      ...run,
      observationSequence: run.observationSequence.toString(),
      verificationSequence: run.verificationSequence.toString(),
      consentRevision: run.consentRevision.toString(),
    }));
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

  private pendingPartitionCounts({
    datasetId,
    userId,
    reviewedMessageIds,
  }: {
    datasetId: string;
    userId: string;
    reviewedMessageIds: readonly string[];
  }) {
    return this.prisma.aiDatasetItem.groupBy({
      by: ['partition'],
      where: {
        datasetId,
        userId,
        sourceType: EMAIL_SOURCE_TYPE,
        ...(reviewedMessageIds.length
          ? { sourceId: { notIn: [...reviewedMessageIds] } }
          : {}),
      },
      _count: { _all: true },
    });
  }

  private ensureDataset() {
    return this.prisma.aiDataset.upsert({
      where: { name: EMAIL_DATASET_NAME },
      create: {
        name: EMAIL_DATASET_NAME,
        purpose: EMAIL_DATASET_PURPOSE,
      },
      update: {},
    });
  }

  private async ensureDatasetItems(userId: string, datasetId: string) {
    const [messages, existing] = await Promise.all([
      this.prisma.aiEmailMessage.findMany({
        where: { userId },
        select: { id: true },
      }),
      this.prisma.aiDatasetItem.findMany({
        where: { datasetId, userId, sourceType: EMAIL_SOURCE_TYPE },
        select: { sourceId: true },
      }),
    ]);
    const included = new Set(existing.map(({ sourceId }) => sourceId));
    const missing = messages.filter(({ id }) => !included.has(id));
    if (!missing.length) {
      return;
    }
    await this.prisma.aiDatasetItem.createMany({
      data: missing.map(({ id }) => ({
        datasetId,
        userId,
        sourceType: EMAIL_SOURCE_TYPE,
        sourceId: id,
        partition: partitionEmailDatasetItem(userId, id),
      })),
      skipDuplicates: true,
    });
  }
}

async function lockReviewGroup(
  tx: Prisma.TransactionClient,
  { userId, groupKey }: { userId: string; groupKey: string },
): Promise<void> {
  // Serialize two batches of the same group: verifications are append-only,
  // so a duplicate written concurrently could not be removed later.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}), hashtext(${groupKey}))`;
}
