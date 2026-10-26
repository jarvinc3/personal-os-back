import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { Prisma, PrismaService } from '@personal-os/database';
import {
  projectKnowledge,
  PROJECTOR_VERSION,
  POLICY_VERSION,
} from './knowledge-projector';
import { NORMALIZER_VERSION } from './knowledge-normalizer';
import { partitionEmailDatasetItem } from '../evidence/dataset-partition.util';

@Injectable()
export class AiKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async listForUser(userId: string) {
    const [personal, global] = await Promise.all([
      this.prisma.aiKnowledge.findMany({
        where: { scope: 'USER', userId },
        orderBy: [{ knowledgeType: 'asc' }, { knowledgeKey: 'asc' }],
      }),
      this.prisma.aiKnowledge.findMany({
        where: { scope: 'GLOBAL', state: 'STABLE' },
        orderBy: [{ knowledgeType: 'asc' }, { knowledgeKey: 'asc' }],
      }),
    ]);
    return { personal, global };
  }

  async adminQueue() {
    return this.prisma.aiKnowledge.findMany({
      where: { scope: 'GLOBAL' },
      orderBy: [{ state: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async revert(userId: string, knowledgeId: string) {
    const item = await this.prisma.aiKnowledge.findFirst({
      where: { id: knowledgeId, scope: 'GLOBAL' },
    });
    if (!item) {
      throw new NotFoundException('Conocimiento GLOBAL no encontrado');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.aiHumanVerification.create({
        data: {
          userId,
          verifierRole: 'ADMIN',
          targetType: 'KNOWLEDGE',
          targetId: item.id,
          verdict: 'REJECTED',
          structuralKeys: [
            {
              knowledgeType: item.knowledgeType,
              knowledgeKey: item.knowledgeKey,
            },
          ],
          normalizerVersion: NORMALIZER_VERSION,
        },
      });
      await tx.aiKnowledge.update({
        where: { id: item.id },
        data: { state: 'BLOCKED', promotedBy: null },
      });
    });
    await this.rebuild(userId);
    return this.prisma.aiKnowledge.findFirst({
      where: {
        scope: 'GLOBAL',
        knowledgeType: item.knowledgeType,
        knowledgeKey: item.knowledgeKey,
      },
    });
  }

  /** Reads the watermarks and their evidence from one committed snapshot. */
  async rebuild(requesterId: string) {
    const minimumContributors =
      this.config.get('AI_GLOBAL_MIN_CONTRIBUTORS', { infer: true }) ??
      (this.config.get('NODE_ENV', { infer: true }) === 'development' ? 1 : 3);
    return this.prisma.$transaction(
      async (tx) => {
        const [
          observationCut,
          verificationCut,
          consentCut,
          dataset,
          priorKnowledge,
        ] = await Promise.all([
          tx.aiKnowledgeObservation.aggregate({ _max: { sequence: true } }),
          tx.aiHumanVerification.aggregate({ _max: { sequence: true } }),
          tx.aiConsentEvent.aggregate({ _max: { sequence: true } }),
          tx.aiDataset.findUnique({ where: { name: 'EMAIL_V1' } }),
          tx.aiKnowledge.findMany(),
        ]);
        if (!dataset) {
          throw new NotFoundException('Dataset EMAIL_V1 no encontrado');
        }
        const [
          items,
          messages,
          verifications,
          reversions,
          observations,
          settings,
        ] = await Promise.all([
          tx.aiDatasetItem.findMany({
            where: { datasetId: dataset.id, sourceType: 'EMAIL_MESSAGE' },
            select: { sourceId: true, partition: true },
          }),
          tx.aiEmailMessage.findMany({
            select: {
              id: true,
              userId: true,
              fromAddress: true,
              subject: true,
            },
          }),
          tx.aiHumanVerification.findMany({
            where: {
              sequence: { lte: verificationCut._max.sequence ?? 0n },
              targetType: 'EMAIL_MESSAGE',
            },
            select: {
              sequence: true,
              userId: true,
              targetId: true,
              verdict: true,
              verifierRole: true,
              correctedPayload: true,
              isGroundTruth: true,
              createdAt: true,
              contributorTombstone: true,
              tombstoneEligible: true,
              structuralKeys: true,
              structuralPayload: true,
            },
          }),
          tx.aiHumanVerification.findMany({
            where: {
              sequence: { lte: verificationCut._max.sequence ?? 0n },
              targetType: 'KNOWLEDGE',
              verifierRole: 'ADMIN',
            },
            select: { sequence: true, verdict: true, structuralKeys: true },
          }),
          tx.aiKnowledgeObservation.findMany({
            where: { sequence: { lte: observationCut._max.sequence ?? 0n } },
            select: {
              sequence: true,
              userId: true,
              sourceId: true,
              knowledgeType: true,
              knowledgeKey: true,
              payload: true,
              derivedFromKnowledgeIds: true,
              createdAt: true,
            },
          }),
          tx.userAiSettings.findMany({
            select: { userId: true, contributeToGlobalKnowledge: true },
          }),
        ]);
        const partitionBySource = new Map(
          items.map((item) => [item.sourceId, item.partition]),
        );
        const missingItems = messages.filter(
          (message) => !partitionBySource.has(message.id),
        );
        if (missingItems.length) {
          await tx.aiDatasetItem.createMany({
            data: missingItems.map((message) => ({
              datasetId: dataset.id,
              userId: message.userId,
              sourceType: 'EMAIL_MESSAGE',
              sourceId: message.id,
              partition: partitionEmailDatasetItem(message.userId, message.id),
            })),
            skipDuplicates: true,
          });
          for (const message of missingItems) {
            partitionBySource.set(
              message.id,
              partitionEmailDatasetItem(message.userId, message.id),
            );
          }
        }
        const inputMessages = messages.flatMap((message) => {
          const partition = partitionBySource.get(message.id);
          return partition ? [{ ...message, partition }] : [];
        });
        const consentByUser = new Map(
          settings.map((row) => [row.userId, row.contributeToGlobalKnowledge]),
        );
        for (const message of inputMessages) {
          if (!consentByUser.has(message.userId)) {
            consentByUser.set(message.userId, true);
          }
        }
        const rows = projectKnowledge({
          messages: inputMessages,
          verifications,
          observations,
          consentByUser,
          observationSequence: observationCut._max.sequence ?? 0n,
          verificationSequence: verificationCut._max.sequence ?? 0n,
          minimumContributors,
          adminReversions: reversions.flatMap((reversal) => {
            if (!Array.isArray(reversal.structuralKeys)) {
              return [];
            }
            return reversal.structuralKeys.flatMap((candidate) => {
              if (
                !candidate ||
                typeof candidate !== 'object' ||
                Array.isArray(candidate)
              ) {
                return [];
              }
              const type = candidate.knowledgeType;
              const key = candidate.knowledgeKey;
              if (
                (type !== 'EMAIL_DOMAIN' && type !== 'EMAIL_TEMPLATE') ||
                typeof key !== 'string'
              ) {
                return [];
              }
              if (
                reversal.verdict !== 'CONFIRMED' &&
                reversal.verdict !== 'REJECTED'
              ) {
                return [];
              }
              return [
                {
                  knowledgeType: type,
                  knowledgeKey: key,
                  sequence: reversal.sequence,
                  verdict: reversal.verdict,
                },
              ];
            });
          }),
        });
        const projectedGlobalKeys = new Set(
          rows
            .filter((row) => row.scope === 'GLOBAL')
            .map((row) => `${row.knowledgeType}|${row.knowledgeKey}`),
        );
        const priorByKey = new Map(
          priorKnowledge.map((row) => [
            `${row.scope}|${row.userId ?? ''}|${row.knowledgeType}|${row.knowledgeKey}`,
            row,
          ]),
        );
        const unsupportedGlobal = priorKnowledge.filter(
          (row) =>
            row.scope === 'GLOBAL' &&
            !projectedGlobalKeys.has(
              `${row.knowledgeType}|${row.knowledgeKey}`,
            ),
        );
        await tx.aiKnowledge.deleteMany();
        await tx.aiKnowledge.createMany({
          data: [
            ...rows.map((row) => ({
              ...row,
              id: priorByKey.get(
                `${row.scope}|${row.userId ?? ''}|${row.knowledgeType}|${row.knowledgeKey}`,
              )?.id,
              payload: row.payload,
              updatedAt: row.lastSeenAt,
            })),
            ...unsupportedGlobal.map((row) => ({
              id: row.id,
              scope: row.scope,
              userId: null,
              knowledgeType: row.knowledgeType,
              knowledgeKey: row.knowledgeKey,
              state: 'REVIEW_REQUIRED' as const,
              payload: row.payload as Prisma.InputJsonValue,
              messagesSeen: 0,
              rejectedMessages: row.rejectedMessages,
              distinctUsers: 0,
              humanVerifiedCount: 0,
              promotedBy: null,
              projectorVersion: PROJECTOR_VERSION,
              policyVersion: POLICY_VERSION,
              normalizerVersion: NORMALIZER_VERSION,
              sanitizerVersion: row.sanitizerVersion,
              firstSeenAt: row.firstSeenAt,
              lastSeenAt: row.lastSeenAt,
              updatedAt: row.updatedAt,
            })),
          ],
        });
        const run = await tx.aiAnalysisRun.create({
          data: {
            userId: requesterId,
            datasetId: dataset.id,
            mode: 'ANALYZE_ONLY',
            status: 'COMPLETED',
            observationSequence: observationCut._max.sequence ?? 0n,
            verificationSequence: verificationCut._max.sequence ?? 0n,
            consentRevision: consentCut._max.sequence ?? 0n,
            reproductionStatus: 'COMPLETE',
            projectorVersion: PROJECTOR_VERSION,
            policyVersion: POLICY_VERSION,
            pipelineVersion: 'ai-pipeline-v1',
            configuration: { snapshot: 'REPEATABLE_READ', minimumContributors },
            completedAt: new Date(),
          },
        });
        return {
          runId: run.id,
          observationSequence: run.observationSequence.toString(),
          verificationSequence: run.verificationSequence.toString(),
          consentRevision: run.consentRevision.toString(),
          items: rows.length + unsupportedGlobal.length,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
