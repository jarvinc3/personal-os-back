import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AppEvents } from '@personal-os/core';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaService } from '@personal-os/database';
import {
  isSafeGlobalTemplateKey,
  knowledgeKeys,
  NORMALIZER_VERSION,
} from './knowledge-normalizer';
import { sanitizeGlobalLabel } from './knowledge-payload';
import { AiKnowledgeService } from './ai-knowledge.service';

@Injectable()
export class AiDataDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: AiKnowledgeService,
  ) {}

  @OnEvent(AppEvents.USER_ACCOUNT_DELETING)
  async beforeAccountDeletion(event: { userId: string }) {
    await this.removeEmailData(event.userId, true);
  }

  async exportForUser(userId: string) {
    const [
      connection,
      messages,
      datasetItems,
      runs,
      observations,
      verifications,
      knowledge,
      consent,
      settings,
      inferences,
    ] = await Promise.all([
      this.prisma.aiEmailConnection.findUnique({
        where: { userId },
        select: {
          id: true,
          provider: true,
          emailAddress: true,
          isActive: true,
          initialSyncCompletedAt: true,
          lastSyncedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.aiEmailMessage.findMany({
        where: { userId },
        include: { content: true },
        orderBy: { receivedAt: 'asc' },
      }),
      this.prisma.aiDatasetItem.findMany({ where: { userId } }),
      this.prisma.aiAnalysisRun.findMany({ where: { userId } }),
      this.prisma.aiKnowledgeObservation.findMany({ where: { userId } }),
      this.prisma.aiHumanVerification.findMany({ where: { userId } }),
      this.prisma.aiKnowledge.findMany({ where: { scope: 'USER', userId } }),
      this.prisma.aiConsentEvent.findMany({ where: { userId } }),
      this.prisma.userAiSettings.findUnique({ where: { userId } }),
      this.prisma.aiInference.findMany({ where: { userId } }),
    ]);
    // Preserve JSON semantics for BigInt sequences without exposing OAuth tokens.
    return JSON.parse(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          connection,
          messages,
          datasetItems,
          runs,
          observations,
          verifications,
          knowledge,
          consent,
          settings,
          inferences,
        },
        (_, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
      ),
    );
  }

  async deleteMyData(userId: string) {
    const now = new Date();
    await this.prisma.userAiSettings.upsert({
      where: { userId },
      create: {
        userId,
        contributeToGlobalKnowledge: false,
        contributionConsentAt: now,
      },
      update: {
        contributeToGlobalKnowledge: false,
        contributionConsentAt: now,
      },
    });
    const result = await this.removeEmailData(userId, true);
    await this.prisma.$transaction(async (tx) => {
      await tx.aiConsentEvent.create({
        data: {
          userId,
          contributeToGlobalKnowledge: false,
          reason: 'USER_DELETED_AI_DATA',
        },
      });
      await tx.aiAnalysisRun.deleteMany({ where: { userId } });
      await tx.aiInference.deleteMany({ where: { userId } });
    });
    return { deleted: true, ...result };
  }

  async removeEmailData(userId: string, deleteConnection = false) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const [
          messages,
          verifications,
          observations,
          settings,
          consentEvents,
          runs,
          datasetItems,
        ] = await Promise.all([
          tx.aiEmailMessage.findMany({
            where: { userId },
            select: { id: true, fromAddress: true, subject: true },
          }),
          tx.aiHumanVerification.findMany({
            where: { userId },
            orderBy: { sequence: 'desc' },
          }),
          tx.aiKnowledgeObservation.findMany({ where: { userId } }),
          tx.userAiSettings.findUnique({ where: { userId } }),
          tx.aiConsentEvent.findMany({ where: { userId } }),
          tx.aiAnalysisRun.findMany({
            select: {
              id: true,
              observationSequence: true,
              verificationSequence: true,
              missingEvidence: true,
            },
          }),
          tx.aiDatasetItem.findMany({
            where: { userId, sourceType: 'EMAIL_MESSAGE' },
            select: { sourceId: true, partition: true },
          }),
        ]);
        const contributorTombstone = randomUUID();
        const consentActive = settings?.contributeToGlobalKnowledge ?? true;
        const byId = new Map(messages.map((message) => [message.id, message]));
        const partitionBySource = new Map(
          datasetItems.map((item) => [item.sourceId, item.partition]),
        );
        const latest = new Set<string>();
        for (const verification of verifications) {
          const message = verification.targetId
            ? byId.get(verification.targetId)
            : null;
          const isLatest = Boolean(message && !latest.has(message.id));
          if (message) {
            latest.add(message.id);
          }
          let structuralKeys: ReturnType<typeof knowledgeKeys> = [];
          let structuralPayload:
            ReturnType<typeof sanitizeGlobalLabel>['label'] | null = null;
          if (
            verification.targetType === 'EMAIL_MESSAGE' &&
            isLatest &&
            partitionBySource.get(message!.id) !== 'HOLDOUT' &&
            !verification.isGroundTruth &&
            consentActive &&
            verification.verdict !== 'REJECTED' &&
            verification.correctedPayload
          ) {
            try {
              structuralKeys = knowledgeKeys(
                message!.fromAddress,
                message!.subject,
              ).filter(
                (key) =>
                  key.knowledgeType === 'EMAIL_DOMAIN' ||
                  (key.knowledgeType === 'EMAIL_TEMPLATE' &&
                    isSafeGlobalTemplateKey(key.knowledgeKey)),
              );
              structuralPayload = sanitizeGlobalLabel(
                verification.correctedPayload,
              ).label;
            } catch {
              structuralKeys = [];
            }
          }
          if (
            verification.targetType === 'KNOWLEDGE' &&
            verification.verifierRole === 'ADMIN' &&
            Array.isArray(verification.structuralKeys)
          ) {
            structuralKeys = verification.structuralKeys.flatMap(
              (candidate) => {
                if (
                  !candidate ||
                  typeof candidate !== 'object' ||
                  Array.isArray(candidate)
                ) {
                  return [];
                }
                const type = candidate.knowledgeType;
                const key = candidate.knowledgeKey;
                return (type === 'EMAIL_DOMAIN' || type === 'EMAIL_TEMPLATE') &&
                  typeof key === 'string'
                  ? [{ knowledgeType: type, knowledgeKey: key }]
                  : [];
              },
            );
          }
          await tx.aiHumanVerification.update({
            where: { sequence: verification.sequence },
            data: {
              userId: null,
              targetId: null,
              correctedPayload: Prisma.DbNull,
              notes: null,
              contributorTombstone,
              normalizerVersion: NORMALIZER_VERSION,
              tombstoneEligible: structuralKeys.length > 0,
              structuralKeys: structuralKeys.length
                ? structuralKeys
                : Prisma.DbNull,
              structuralPayload: structuralPayload ?? Prisma.DbNull,
            },
          });
        }
        for (const observation of observations) {
          const source = observation.sourceId
            ? byId.get(observation.sourceId)
            : undefined;
          const matchesSource = source
            ? knowledgeKeys(source.fromAddress, source.subject).some(
                (key) =>
                  key.knowledgeType === observation.knowledgeType &&
                  key.knowledgeKey === observation.knowledgeKey,
              )
            : false;
          const eligible =
            consentActive &&
            matchesSource &&
            partitionBySource.get(observation.sourceId ?? '') !== 'HOLDOUT' &&
            observation.sourceType === 'EMAIL_MESSAGE' &&
            (observation.knowledgeType === 'EMAIL_DOMAIN' ||
              observation.knowledgeType === 'EMAIL_TEMPLATE') &&
            (observation.knowledgeType !== 'EMAIL_TEMPLATE' ||
              isSafeGlobalTemplateKey(observation.knowledgeKey)) &&
            observation.derivedFromKnowledgeIds.length === 0;
          await tx.aiKnowledgeObservation.update({
            where: { sequence: observation.sequence },
            data: {
              userId: null,
              sourceId: null,
              inferenceId: null,
              runId: null,
              payload: Prisma.DbNull,
              knowledgeKey: eligible ? observation.knowledgeKey : 'REDACTED',
              contributorTombstone,
              tombstoneEligible: eligible,
              normalizerVersion: NORMALIZER_VERSION,
              derivedFromKnowledgeIds: [],
            },
          });
        }
        for (const event of consentEvents) {
          await tx.aiConsentEvent.update({
            where: { sequence: event.sequence },
            data: { userId: null, contributorTombstone },
          });
        }
        for (const run of runs) {
          const removedVerifications = verifications.filter(
            (item) => item.sequence <= run.verificationSequence,
          ).length;
          const removedObservations = observations.filter(
            (item) => item.sequence <= run.observationSequence,
          ).length;
          if (!removedVerifications && !removedObservations) {
            continue;
          }
          const previous =
            run.missingEvidence &&
            typeof run.missingEvidence === 'object' &&
            !Array.isArray(run.missingEvidence)
              ? (run.missingEvidence as Record<string, unknown>)
              : {};
          await tx.aiAnalysisRun.update({
            where: { id: run.id },
            data: {
              reproductionStatus: 'INCOMPLETE',
              missingEvidence: {
                humanVerifications:
                  Number(previous.humanVerifications ?? 0) +
                  removedVerifications,
                observations:
                  Number(previous.observations ?? 0) + removedObservations,
              },
            },
          });
        }
        await tx.aiKnowledge.deleteMany({ where: { scope: 'USER', userId } });
        // Fail closed if the following rebuild fails: no GLOBAL row remains usable.
        await tx.aiKnowledge.updateMany({
          where: { scope: 'GLOBAL' },
          data: { state: 'REVIEW_REQUIRED', promotedBy: null },
        });
        await tx.aiDatasetItem.deleteMany({
          where: { userId, sourceType: 'EMAIL_MESSAGE' },
        });
        await tx.aiEmailMessage.deleteMany({ where: { userId } });
        await tx.aiInference.deleteMany({
          where: { userId, sourceType: 'EMAIL_MESSAGE' },
        });
        if (deleteConnection) {
          await tx.aiEmailConnection.deleteMany({ where: { userId } });
        } else {
          await tx.aiEmailConnection.updateMany({
            where: { userId },
            data: {
              providerCursor: null,
              bootstrapPageToken: null,
              bootstrapStartedAt: null,
              initialSyncCompletedAt: null,
              lastSyncedAt: null,
              lastRecoverySyncAt: null,
              importedMessageCount: 0,
              lastSyncErrorCode: null,
              syncState: Prisma.DbNull,
            },
          });
        }
        return {
          deletedMessages: messages.length,
          detachedVerifications: verifications.length,
          detachedObservations: observations.length,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    await this.knowledge.rebuild(userId);
    return result;
  }
}
