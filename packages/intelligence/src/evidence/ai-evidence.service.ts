import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
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
} from './review-queue.constants';
import {
  assertReviewQueueDateRange,
  encodeReviewQueueCursor,
  latestReviewVerifications,
  reviewQueueItems,
  reviewQueueMessageFilter,
  reviewQueueMessageSearchFilter,
  reviewQueuePendingCounts,
  reviewQueueReceivedAtFilter,
  reviewQueueSortDirection,
} from './review-queue.util';
import { groupReviewMessages } from './review-groups.util';
import { PROJECTOR_VERSION } from '../knowledge/knowledge-projector';
import { POLICY_VERSION } from '../knowledge/knowledge-policy';
import { EMAIL_CLASSIFICATION_VERSIONS } from '../email/email-classification.util';
import {
  verificationLabel,
  type ReclassificationResult,
} from '../email/email-reclassification.util';
import { AiEmailReclassificationService } from '../email/email-reclassification.service';
import { calculateHoldoutMetrics } from './holdout-metrics.util';

import { EMAIL_DATASET_NAME, EMAIL_DATASET_PURPOSE } from './dataset.constants';

const EMAIL_SOURCE_TYPE = 'EMAIL_MESSAGE';
const REVIEW_TARGET_TYPE = 'EMAIL_MESSAGE';
const VERIFICATION_SELECT = {
  sequence: true,
  verifierRole: true,
  targetType: true,
  targetId: true,
  verdict: true,
  correctedPayload: true,
  notes: true,
  isGroundTruth: true,
  createdAt: true,
} as const;

@Injectable()
export class AiEvidenceService {
  private readonly logger = new Logger(AiEvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reclassification: AiEmailReclassificationService,
  ) {}

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
    const matchingMessageIds = Object.keys(searchFilter).length
      ? new Set(
          (
            await this.prisma.aiEmailMessage.findMany({
              where: { userId, ...searchFilter },
              select: { id: true },
            })
          ).map(({ id }) => id),
        )
      : undefined;
    const counts = reviewQueuePendingCounts({
      items: datasetItems,
      reviewedMessageIds: [...latestByMessageId.keys()],
      matchingMessageIds,
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
        receivedAt,
        cursor: query.cursor,
        order,
        uncertain: query.uncertain,
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
    const items = reviewQueueItems({
      messages: pageMessages,
      partitionByMessageId,
      latestByMessageId,
    });
    const last = pageMessages.at(-1);
    return {
      items,
      counts,
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
    const outcome = await this.prisma.$transaction(async (tx) => {
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
    const requeued = await this.reclassifyAfterVerification(
      () =>
        this.reclassification.reclassifyAfterReviewGroupVerification({
          userId,
          fromAddress: dto.fromAddress,
          templateFingerprint: dto.templateFingerprint ?? null,
          correctedLabel: verificationLabel({
            verdict: dto.verdict,
            correctedPayload: correctedPayload ?? null,
          }),
        }),
      `review group ${dto.fromAddress}`,
    );
    return { ...outcome, requeued };
  }

  async verifyMessage(
    userId: string,
    messageId: string,
    dto: CreateHumanVerificationDto,
  ) {
    const dataset = await this.ensureDataset();
    await this.ensureDatasetItems(userId, dataset.id);
    const [message, item, roleAssignment, latestVerification] =
      await Promise.all([
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
        this.prisma.aiHumanVerification.findFirst({
          where: {
            userId,
            targetType: REVIEW_TARGET_TYPE,
            targetId: messageId,
          },
          orderBy: { sequence: 'desc' },
          select: VERIFICATION_SELECT,
        }),
      ]);
    if (!message || !item) {
      throw new NotFoundException('Mensaje no encontrado');
    }
    assertHumanVerificationLabels(dto);

    const correctedPayload = humanVerificationPayload(dto);
    const notes = dto.notes?.trim() || null;
    const verification =
      this.retryVerification({
        latestVerification,
        verdict: dto.verdict,
        correctedPayload,
        notes,
      }) ??
      (await this.prisma.aiHumanVerification.create({
        data: {
          userId,
          verifierRole: roleAssignment?.role ?? 'USER',
          targetType: REVIEW_TARGET_TYPE,
          targetId: messageId,
          verdict: dto.verdict,
          correctedPayload: correctedPayload as never,
          notes,
          isGroundTruth: item.partition === 'HOLDOUT',
        },
        select: VERIFICATION_SELECT,
      }));
    const requeued = await this.reclassifyAfterVerification(
      () =>
        this.reclassification.reclassifyAfterMessageVerification({
          userId,
          messageId,
          correctedLabel: verificationLabel({
            verdict: dto.verdict,
            correctedPayload: correctedPayload ?? null,
          }),
        }),
      `message ${messageId}`,
    );
    return {
      ...verification,
      sequence: verification.sequence.toString(),
      requeued,
    };
  }

  /**
   * Repetir la misma verificación no agrega evidencia: el reintento reutiliza
   * la última fila idéntica y solo vuelve a intentar la reclasificación.
   */
  private retryVerification<
    T extends {
      verdict: string;
      correctedPayload: unknown;
      notes: string | null;
    },
  >({
    latestVerification,
    verdict,
    correctedPayload,
    notes,
  }: {
    latestVerification: T | null;
    verdict: string;
    correctedPayload: Record<string, unknown> | undefined;
    notes: string | null;
  }): T | null {
    if (!latestVerification) {
      return null;
    }
    const sameVerification =
      latestVerification.verdict === verdict &&
      latestVerification.notes === notes &&
      isDeepStrictEqual(
        latestVerification.correctedPayload ?? null,
        correctedPayload ?? null,
      );
    return sameVerification ? latestVerification : null;
  }

  private async reclassifyAfterVerification(
    reclassify: () => Promise<ReclassificationResult>,
    context: string,
  ): Promise<number> {
    try {
      const { requeued } = await reclassify();
      return requeued;
    } catch (error) {
      // La verificación ya está guardada. El reintento es idempotente: reutiliza
      // la fila y vuelve a intentar la reclasificación.
      this.logger.warn(
        `Reclassification failed after ${context}: ${safeErrorCode(error)}`,
      );
      throw new Error(
        'La verificación quedó guardada, pero no se pudo reclasificar el historial. Reintenta la misma verificación.',
        { cause: error },
      );
    }
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
            pipelineVersion:
              mode === 'EVALUATE'
                ? EMAIL_CLASSIFICATION_VERSIONS.pipeline
                : 'ai-pipeline-v1',
            detectorVersion:
              mode === 'EVALUATE'
                ? EMAIL_CLASSIFICATION_VERSIONS.detector
                : 'email-detector-v1',
            promptVersion:
              mode === 'EVALUATE' ? EMAIL_CLASSIFICATION_VERSIONS.prompt : null,
            schemaVersion:
              mode === 'EVALUATE'
                ? EMAIL_CLASSIFICATION_VERSIONS.schema
                : 'ai-review-v1',
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

  async evaluateHoldout(userId: string) {
    const dataset = await this.ensureDataset();
    await this.ensureDatasetItems(userId, dataset.id);
    const holdout = await this.prisma.aiDatasetItem.findMany({
      where: {
        datasetId: dataset.id,
        userId,
        sourceType: EMAIL_SOURCE_TYPE,
        partition: 'HOLDOUT',
      },
      orderBy: { sourceId: 'asc' },
      select: { sourceId: true },
    });
    const ids = holdout.map(({ sourceId }) => sourceId);
    const run = await this.startAnalysisRun(userId, 'EVALUATE', {
      evaluationSet: 'HOLDOUT',
      evaluationVersion: 'holdout-metrics-v1',
      frozen: true,
      holdoutMessages: ids.length,
      holdoutFingerprint: createHash('sha256')
        .update(ids.join('\n'))
        .digest('hex'),
      parserVersion: EMAIL_CLASSIFICATION_VERSIONS.parser,
    });
    try {
      const [classifications, verifications] = await Promise.all([
        this.prisma.aiEmailClassification.findMany({
          where: {
            userId,
            messageId: { in: ids },
            createdAt: { lte: run.startedAt },
          },
          select: {
            messageId: true,
            route: true,
            relevance: true,
            semanticType: true,
            decisionPath: true,
          },
        }),
        this.prisma.aiHumanVerification.findMany({
          where: {
            userId,
            targetType: REVIEW_TARGET_TYPE,
            targetId: { in: ids },
            isGroundTruth: true,
            sequence: { lte: run.verificationSequence },
          },
          orderBy: [{ targetId: 'asc' }, { sequence: 'desc' }],
          distinct: ['targetId'],
          select: { targetId: true, correctedPayload: true },
        }),
      ]);
      const metrics = calculateHoldoutMetrics(
        classifications.map((row) => ({ ...row, messageId: row.messageId })),
        verifications.flatMap((row) =>
          row.targetId
            ? [{ messageId: row.targetId, payload: row.correctedPayload }]
            : [],
        ),
      );
      const completed = await this.completeAnalysisRun(userId, run.id, {
        metrics,
      });
      return serializeRun(completed);
    } catch (error) {
      await this.completeAnalysisRun(userId, run.id, {
        error:
          error instanceof Error ? error.message : 'Evaluación HOLDOUT fallida',
      });
      throw error;
    }
  }

  async compareRuns(userId: string, firstId: string, secondId: string) {
    if (firstId === secondId) {
      throw new BadRequestException('Selecciona dos runs distintos');
    }
    const runs = await this.prisma.aiAnalysisRun.findMany({
      where: { userId, id: { in: [firstId, secondId] } },
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
    if (runs.length !== 2) {
      throw new NotFoundException('Run no encontrado');
    }
    const [first, second] = runs;
    const same =
      first.mode === 'EVALUATE' &&
      second.mode === 'EVALUATE' &&
      first.status === 'COMPLETED' &&
      second.status === 'COMPLETED' &&
      first.datasetId === second.datasetId &&
      first.observationSequence === second.observationSequence &&
      first.verificationSequence === second.verificationSequence &&
      first.consentRevision === second.consentRevision &&
      first.projectorVersion === second.projectorVersion &&
      first.policyVersion === second.policyVersion &&
      first.pipelineVersion === second.pipelineVersion &&
      first.detectorVersion === second.detectorVersion &&
      first.promptVersion === second.promptVersion &&
      first.schemaVersion === second.schemaVersion &&
      JSON.stringify(first.configuration) ===
        JSON.stringify(second.configuration);
    return {
      comparable: same,
      warning: same
        ? null
        : 'Los runs usan distintos watermarks, versiones, dataset o configuración.',
      first: serializeRun(first),
      second: serializeRun(second),
      deltas: same ? metricDeltas(first.metrics, second.metrics) : null,
    };
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

function serializeRun<
  T extends {
    observationSequence: bigint;
    verificationSequence: bigint;
    consentRevision?: bigint;
  },
>(run: T) {
  return {
    ...run,
    observationSequence: run.observationSequence.toString(),
    verificationSequence: run.verificationSequence.toString(),
    ...(run.consentRevision !== undefined
      ? { consentRevision: run.consentRevision.toString() }
      : {}),
  };
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code).slice(0, 80);
  }
  return 'RECLASSIFICATION_FAILED';
}

function metricDeltas(
  first: unknown,
  second: unknown,
): Record<string, number | null> {
  if (
    !first ||
    typeof first !== 'object' ||
    !second ||
    typeof second !== 'object'
  ) {
    return {};
  }
  const a = first as Record<string, unknown>;
  const b = second as Record<string, unknown>;
  return Object.fromEntries(
    [
      'transactionRecall',
      'precision',
      'deterministicCoverage',
      'modelFallbackRate',
      'unknownRate',
    ].map((key) => {
      const left = a[key];
      const right = b[key];
      return [
        key,
        typeof left === 'number' && typeof right === 'number'
          ? right - left
          : null,
      ];
    }),
  );
}
