import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@personal-os/database';
import type { PrismaService } from '@personal-os/database';
import { EMAIL_CLASSIFICATION_VERSIONS } from '../email/email-classification.util';
import { POLICY_VERSION } from '../knowledge/knowledge-policy';
import { PROJECTOR_VERSION } from '../knowledge/knowledge-projector';
import type { EmailEvidenceDataset } from './email-evidence-dataset';
import {
  EMAIL_SOURCE_TYPE,
  REVIEW_TARGET_TYPE,
} from './email-evidence.constants';
import { calculateHoldoutMetrics } from './holdout-metrics.util';

type EmailAnalysisRunsDependencies = {
  prisma: PrismaService;
  dataset: EmailEvidenceDataset;
};

/** Runs de análisis: abrir, cerrar, listar, comparar y evaluar HOLDOUT. */
export class EmailAnalysisRuns {
  private readonly prisma: PrismaService;
  private readonly dataset: EmailEvidenceDataset;

  constructor({ prisma, dataset }: EmailAnalysisRunsDependencies) {
    this.prisma = prisma;
    this.dataset = dataset;
  }

  async startAnalysisRun(
    userId: string,
    mode: 'ANALYZE_ONLY' | 'EVALUATE' | 'IMPORT',
    configuration: Record<string, unknown>,
  ) {
    const dataset = await this.dataset.ensure();
    await this.dataset.ensureItems(userId, dataset.id);
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
    const dataset = await this.dataset.ensure();
    await this.dataset.ensureItems(userId, dataset.id);
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
