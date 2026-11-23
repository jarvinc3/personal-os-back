import type { Logger } from '@nestjs/common';
import type { PrismaService } from '@personal-os/database';
import {
  EMAIL_DATASET_NAME,
  EMAIL_DATASET_PURPOSE,
} from '../evidence/dataset.constants';
import { POLICY_VERSION } from '../knowledge/knowledge-policy';
import { PROJECTOR_VERSION } from '../knowledge/knowledge-projector';
import { EMAIL_CLASSIFICATION_VERSIONS } from './email-classification.util';

type EmailReclassificationRunsDependencies = {
  prisma: PrismaService;
  logger: Logger;
};

/** El run de análisis que deja cada pase de reclasificación. */
export class EmailReclassificationRuns {
  private readonly prisma: PrismaService;
  private readonly logger: Logger;

  constructor({ prisma, logger }: EmailReclassificationRunsDependencies) {
    this.prisma = prisma;
    this.logger = logger;
  }

  async start({
    userId,
    trigger,
    reviewConfidenceThreshold,
  }: {
    userId: string;
    trigger: string;
    reviewConfidenceThreshold: number;
  }): Promise<string> {
    const dataset = await this.prisma.aiDataset.upsert({
      where: { name: EMAIL_DATASET_NAME },
      create: {
        name: EMAIL_DATASET_NAME,
        purpose: EMAIL_DATASET_PURPOSE,
        sourceType: 'EMAIL',
      },
      update: {},
      select: { id: true },
    });
    const [observationWatermark, verificationWatermark, consentWatermark] =
      await Promise.all([
        this.prisma.aiKnowledgeObservation.aggregate({
          _max: { sequence: true },
        }),
        this.prisma.aiHumanVerification.aggregate({ _max: { sequence: true } }),
        this.prisma.aiConsentEvent.aggregate({
          where: { userId },
          _max: { sequence: true },
        }),
      ]);
    const run = await this.prisma.aiAnalysisRun.create({
      data: {
        userId,
        datasetId: dataset.id,
        mode: 'ANALYZE_ONLY',
        status: 'RUNNING',
        observationSequence: observationWatermark._max.sequence ?? 0n,
        verificationSequence: verificationWatermark._max.sequence ?? 0n,
        consentRevision: consentWatermark._max.sequence ?? 0n,
        projectorVersion: PROJECTOR_VERSION,
        policyVersion: POLICY_VERSION,
        pipelineVersion: EMAIL_CLASSIFICATION_VERSIONS.pipeline,
        configuration: {
          trigger,
          parserVersion: EMAIL_CLASSIFICATION_VERSIONS.parser,
          reviewConfidenceThreshold,
        },
      },
      select: { id: true },
    });
    return run.id;
  }

  async complete({
    runId,
    requeued,
    skipped,
  }: {
    runId: string;
    requeued: number;
    skipped: number;
  }): Promise<void> {
    await this.prisma.aiAnalysisRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        metrics: { requeued, skipped },
      },
    });
  }

  /** Un pase que no termina cierra su run como fallido; nunca lo deja en RUNNING. */
  async fail({
    runId,
    requeued,
    skipped,
    error,
  }: {
    runId: string;
    requeued: number;
    skipped: number;
    error: unknown;
  }): Promise<void> {
    try {
      await this.prisma.aiAnalysisRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          metrics: { requeued, skipped },
          error: reclassificationErrorCode(error),
        },
      });
    } catch (markError) {
      // No se oculta el fallo original: se registra el del cierre y se relanza aquel.
      this.logger.error(
        `Unable to mark reclassification run ${runId} as FAILED: ${reclassificationErrorCode(markError)}`,
      );
    }
  }
}

/** Código seguro: el mensaje del error puede traer datos y no se persiste. */
function reclassificationErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code).slice(0, 80);
  }
  return 'RECLASSIFICATION_FAILED';
}
