import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import type { CreateHumanVerificationDto } from './dto/create-human-verification.dto';
import { partitionEmailDatasetItem } from './dataset-partition.util';

const DATASET_NAME = 'EMAIL_V1';
const EMAIL_SOURCE_TYPE = 'EMAIL_MESSAGE';
const REVIEW_TARGET_TYPE = 'EMAIL_MESSAGE';
const PAGE_SIZE = 50;
const REVIEW_PARTITIONS = ['TRAIN', 'VALIDATION', 'HOLDOUT'] as const;

type ReviewPartition = (typeof REVIEW_PARTITIONS)[number];

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

  async reviewQueue(userId: string, cursor?: string, partition?: string) {
    if (
      partition &&
      !REVIEW_PARTITIONS.includes(partition as ReviewPartition)
    ) {
      throw new BadRequestException('Partición de revisión inválida');
    }
    const dataset = await this.ensureDataset();
    await this.ensureDatasetItems(userId, dataset.id);
    const cursorValues = this.parseCursor(cursor);
    const reviewed = await this.prisma.aiHumanVerification.findMany({
      where: { userId, targetType: REVIEW_TARGET_TYPE },
      distinct: ['targetId'],
      select: { targetId: true },
    });
    const reviewedIds = reviewed.map(({ targetId }) => targetId);
    const pendingWhere = {
      datasetId: dataset.id,
      userId,
      sourceType: EMAIL_SOURCE_TYPE,
      ...(reviewedIds.length ? { sourceId: { notIn: reviewedIds } } : {}),
    };
    const [partitionCounts, pendingItems] = await Promise.all([
      this.prisma.aiDatasetItem.groupBy({
        by: ['partition'],
        where: pendingWhere,
        _count: { _all: true },
      }),
      this.prisma.aiDatasetItem.findMany({
        where: {
          ...pendingWhere,
          ...(partition ? { partition: partition as ReviewPartition } : {}),
        },
        select: { sourceId: true, partition: true },
      }),
    ]);
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
    const partitionByMessageId = new Map(
      pendingItems.map((item) => [item.sourceId, item.partition]),
    );
    const messages = await this.prisma.aiEmailMessage.findMany({
      where: {
        userId,
        id: { in: pendingItems.map(({ sourceId }) => sourceId) },
        ...(cursorValues
          ? {
              OR: [
                { receivedAt: { gt: new Date(cursorValues.receivedAt) } },
                {
                  receivedAt: new Date(cursorValues.receivedAt),
                  id: { gt: cursorValues.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: PAGE_SIZE + 1,
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
    const hasMore = messages.length > PAGE_SIZE;
    const pageMessages = hasMore ? messages.slice(0, PAGE_SIZE) : messages;
    const rows = pageMessages.flatMap((message) => {
      const partition = partitionByMessageId.get(message.id);
      return partition ? [{ ...message, partition }] : [];
    });
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
          ? Buffer.from(
              JSON.stringify({
                receivedAt: last.receivedAt.toISOString(),
                id: last.id,
              }),
            ).toString('base64url')
          : null,
    };
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
    if (dto.verdict === 'REJECTED' && !dto.notes?.trim()) {
      throw new BadRequestException('Indica por qué se rechaza este mensaje');
    }
    if (
      dto.verdict === 'CORRECTED' &&
      dto.relevance === undefined &&
      dto.semanticType === undefined &&
      dto.routes === undefined &&
      dto.transaction === undefined
    ) {
      throw new BadRequestException('Incluye al menos una etiqueta corregida');
    }
    if (dto.semanticType === 'OTHER' && !dto.notes?.trim()) {
      throw new BadRequestException('El tipo Otro requiere una nota');
    }
    if (dto.semanticType === 'FIN_TRANSACTION') {
      if (!dto.transaction?.kind) {
        throw new BadRequestException('Indica el tipo de transacción');
      }
    } else if (
      dto.semanticType === 'PURCHASE_RECEIPT' ||
      dto.semanticType === 'SUBSCRIPTION_BILLING'
    ) {
      if (dto.transaction?.kind !== undefined) {
        throw new BadRequestException('El recibo o cobro no admite kind');
      }
    } else if (dto.transaction !== undefined) {
      throw new BadRequestException('Este tipo no admite transacción');
    }
    if (
      (dto.semanticType === 'SECURITY_ALERT' && dto.relevance === false) ||
      (dto.semanticType === 'SECURITY_OTP' && dto.relevance === true)
    ) {
      throw new BadRequestException('Relevancia incompatible con el tipo');
    }

    const correctedPayload = this.labelPayload(dto);
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
    const [observationWatermark, verificationWatermark] = await Promise.all([
      this.prisma.aiKnowledgeObservation.aggregate({
        _max: { sequence: true },
      }),
      this.prisma.aiHumanVerification.aggregate({ _max: { sequence: true } }),
    ]);
    return this.prisma.aiAnalysisRun.create({
      data: {
        userId,
        datasetId: dataset.id,
        mode,
        observationSequence: observationWatermark._max.sequence ?? 0n,
        verificationSequence: verificationWatermark._max.sequence ?? 0n,
        projectorVersion: 'ai-projector-v1',
        policyVersion: 'ai-policy-v1',
        pipelineVersion: 'ai-pipeline-v1',
        detectorVersion: 'email-detector-v1',
        schemaVersion: 'ai-review-v1',
        configuration: JSON.parse(JSON.stringify(configuration)),
      },
    });
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
    }));
  }

  private ensureDataset() {
    return this.prisma.aiDataset.upsert({
      where: { name: DATASET_NAME },
      create: {
        name: DATASET_NAME,
        purpose: 'Corpus versionado de mensajes para análisis y evaluación.',
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

  private parseCursor(cursor?: string) {
    if (!cursor) {
      return undefined;
    }
    try {
      const values = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as { receivedAt?: string; id?: string };
      if (!values.id || !Number.isFinite(Date.parse(values.receivedAt ?? ''))) {
        throw new Error('invalid cursor');
      }
      return { receivedAt: values.receivedAt!, id: values.id };
    } catch {
      throw new BadRequestException('Cursor de revisión inválido');
    }
  }

  private labelPayload(dto: CreateHumanVerificationDto) {
    const entries = Object.entries(dto).filter(
      ([key, value]) =>
        key !== 'verdict' && key !== 'notes' && value !== undefined,
    );
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
}
