import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, type Prisma } from '@personal-os/database';
import {
  EMAIL_CLASSIFICATION_VERSIONS,
  type EmailClassification,
} from './email-classification.util';
import {
  buildClassificationRows,
  buildFinanceSignal,
  classificationLabel,
  EMAIL_REVIEW_CONFIDENCE_THRESHOLD,
  requiresReview,
  type ClassificationProvenance,
} from './email-classification-persistence';
import {
  currentClassificationLabel,
  dominantClassification,
  knowledgeProvenanceForRow,
  mergedCandidateLabel,
  RECLASSIFIABLE_STATUSES,
  RECLASSIFICATION_CLAIM_CHUNK_SIZE,
  RECLASSIFICATION_MAX_MESSAGES,
  sharedKnowledgeProvenance,
  structuralLabel,
  type KnowledgeProvenance,
  type ReclassificationResult,
} from './email-reclassification.util';
import { partitionEmailDatasetItem } from '../evidence/dataset-partition.util';
import {
  EMAIL_DATASET_NAME,
  EMAIL_DATASET_PURPOSE,
} from '../evidence/dataset.constants';
import {
  knowledgeKeys,
  normalizeSender,
} from '../knowledge/knowledge-normalizer';
import { POLICY_VERSION } from '../knowledge/knowledge-policy';
import { PROJECTOR_VERSION } from '../knowledge/knowledge-projector';
import type { EmailLabel } from '../knowledge/knowledge-payload';

const EMAIL_SOURCE_TYPE = 'EMAIL_MESSAGE';
const REVIEW_TARGET_TYPE = 'EMAIL_MESSAGE';
const HOLDOUT_PARTITION = 'HOLDOUT';
const KNOWLEDGE_DECISION_PATH = 'KNOWLEDGE';

export type KnowledgeRowRef = {
  knowledgeType: string;
  knowledgeKey: string;
  scope: string;
  payload: Prisma.JsonValue;
};

type ReclassifiableMessage = {
  id: string;
  receivedAt: Date;
  fromAddress: string;
  subject: string;
  templateFingerprint: string | null;
  processingStatus: string;
  classification: Prisma.JsonValue | null;
};

type ReclassifiedMessage = {
  message: ReclassifiableMessage;
  classification: EmailClassification;
  provenance: ClassificationProvenance;
};

type ChunkPlan = {
  reclassified: ReclassifiedMessage[];
  skippedIds: string[];
};

type ReclassifyScopeInput = {
  userId: string;
  where: Prisma.AiEmailMessageWhereInput;
  matches: (message: ReclassifiableMessage) => boolean;
  structural: EmailLabel;
  provenanceFor: (message: ReclassifiableMessage) => KnowledgeProvenance[];
  trigger: string;
};

@Injectable()
export class AiEmailReclassificationService {
  private readonly logger = new Logger(AiEmailReclassificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * La verificación de un correo enseña lo que su remitente envía. Se aplica a
   * los demás correos del remitente, nunca al verificado ni a HOLDOUT.
   */
  async reclassifyAfterMessageVerification({
    userId,
    messageId,
    correctedLabel,
  }: {
    userId: string;
    messageId: string;
    correctedLabel: Record<string, unknown> | null;
  }): Promise<ReclassificationResult> {
    const verified = await this.prisma.aiEmailMessage.findFirst({
      where: { id: messageId, userId },
      select: {
        id: true,
        fromAddress: true,
        subject: true,
        classification: true,
      },
    });
    if (!verified) {
      return { requeued: 0 };
    }
    if (await this.isHoldout(userId, messageId)) {
      return { requeued: 0 };
    }
    const structural = structuralLabel(
      correctedLabel ?? verified.classification,
    );
    if (!structural) {
      return { requeued: 0 };
    }
    return this.reclassifyScope({
      userId,
      where: { fromAddress: verified.fromAddress },
      matches: () => true,
      structural,
      provenanceFor: (candidate) =>
        sharedKnowledgeProvenance({ verified, candidate }),
      trigger: 'MESSAGE_VERIFICATION',
    });
  }

  /**
   * El lote confirma un remitente y una plantilla; el resto de correos del
   * remitente se reclasifica con esa etiqueta estructural.
   */
  async reclassifyAfterReviewGroupVerification({
    userId,
    fromAddress,
    templateFingerprint,
    correctedLabel,
  }: {
    userId: string;
    fromAddress: string;
    templateFingerprint: string | null;
    correctedLabel: Record<string, unknown> | null;
  }): Promise<ReclassificationResult> {
    const groupMessages = await this.prisma.aiEmailMessage.findMany({
      where: { userId, fromAddress, templateFingerprint },
      select: {
        id: true,
        receivedAt: true,
        fromAddress: true,
        subject: true,
        classification: true,
      },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    });
    const representative = groupMessages[0];
    if (!representative) {
      return { requeued: 0 };
    }
    const partitions = await this.partitionsFor(
      userId,
      groupMessages.map(({ id }) => id),
    );
    const labelledGroup = groupMessages.filter(
      ({ id }) => partitions.get(id) !== HOLDOUT_PARTITION,
    );
    const structural = structuralLabel(
      correctedLabel ?? this.dominantGroupLabel(labelledGroup),
    );
    if (!structural) {
      return { requeued: 0 };
    }
    return this.reclassifyScope({
      userId,
      where: { fromAddress },
      matches: () => true,
      structural,
      provenanceFor: (candidate) =>
        sharedKnowledgeProvenance({ verified: representative, candidate }),
      trigger: 'GROUP_VERIFICATION',
    });
  }

  /** Una promoción GLOBAL deja conocimiento estable: se aplica al historial propio. */
  async reclassifyAfterKnowledgePromotion({
    userId,
    knowledge,
  }: {
    userId: string;
    knowledge: KnowledgeRowRef;
  }): Promise<ReclassificationResult> {
    const structural = structuralLabel(this.knowledgeLabel(knowledge.payload));
    if (!structural) {
      return { requeued: 0 };
    }
    const scope = this.knowledgeScope(knowledge);
    if (!scope) {
      return { requeued: 0 };
    }
    return this.reclassifyScope({
      userId,
      where: scope.where,
      matches: scope.matches,
      structural,
      provenanceFor: () => knowledgeProvenanceForRow(knowledge),
      trigger: 'KNOWLEDGE_PROMOTION',
    });
  }

  /** Una reversión deja sin conocimiento a los correos que lo usaron: vuelven a la cola. */
  async requeueAfterKnowledgeRevert({
    userId,
    knowledge,
  }: {
    userId: string;
    knowledge: { knowledgeType: string; knowledgeKey: string };
  }): Promise<ReclassificationResult> {
    const used = await this.prisma.aiEmailClassification.findMany({
      where: {
        userId,
        knowledgeUsed: {
          array_contains: [
            {
              knowledgeType: knowledge.knowledgeType,
              knowledgeKey: knowledge.knowledgeKey,
            },
          ],
        },
      },
      select: { messageId: true },
      distinct: ['messageId'],
    });
    const messageIds = used.map(({ messageId }) => messageId);
    if (!messageIds.length) {
      return { requeued: 0 };
    }
    const eligible = await this.eligibleMessages({
      userId,
      where: { id: { in: messageIds } },
      matches: () => true,
    });
    if (!eligible.length) {
      return { requeued: 0 };
    }
    const updated = await this.prisma.aiEmailMessage.updateMany({
      where: {
        userId,
        id: { in: eligible.map(({ id }) => id) },
        processingStatus: { in: [...RECLASSIFIABLE_STATUSES] },
      },
      data: { processingStatus: 'QUEUED', classificationStartedAt: null },
    });
    return { requeued: updated.count };
  }

  private async reclassifyScope(
    input: ReclassifyScopeInput,
  ): Promise<ReclassificationResult> {
    const messages = await this.eligibleMessages(input);
    if (!messages.length) {
      return { requeued: 0 };
    }
    const runId = await this.startRun({
      userId: input.userId,
      trigger: input.trigger,
    });
    let requeued = 0;
    let skipped = 0;
    for (
      let start = 0;
      start < messages.length;
      start += RECLASSIFICATION_CLAIM_CHUNK_SIZE
    ) {
      const chunk = messages.slice(
        start,
        start + RECLASSIFICATION_CLAIM_CHUNK_SIZE,
      );
      const outcome = await this.reclassifyChunk({
        userId: input.userId,
        chunk,
        structural: input.structural,
        provenanceFor: input.provenanceFor,
      });
      requeued += outcome.requeued;
      skipped += outcome.skipped;
    }
    await this.completeRun({ runId, requeued, skipped });
    this.logger.debug(
      `Reclassified ${requeued} messages for ${input.userId} (${input.trigger})`,
    );
    return { requeued };
  }

  private async eligibleMessages({
    userId,
    where,
    matches,
  }: {
    userId: string;
    where: Prisma.AiEmailMessageWhereInput;
    matches: (message: ReclassifiableMessage) => boolean;
  }): Promise<ReclassifiableMessage[]> {
    const messages = await this.prisma.aiEmailMessage.findMany({
      where: {
        ...where,
        userId,
        processingStatus: { in: [...RECLASSIFIABLE_STATUSES] },
      },
      select: {
        id: true,
        receivedAt: true,
        fromAddress: true,
        subject: true,
        templateFingerprint: true,
        processingStatus: true,
        classification: true,
      },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: RECLASSIFICATION_MAX_MESSAGES,
    });
    const candidates = messages.filter(matches);
    if (!candidates.length) {
      return [];
    }
    const ids = candidates.map(({ id }) => id);
    const [verifications, partitionByMessage] = await Promise.all([
      this.prisma.aiHumanVerification.findMany({
        where: {
          userId,
          targetType: REVIEW_TARGET_TYPE,
          targetId: { in: ids },
        },
        distinct: ['targetId'],
        select: { targetId: true },
      }),
      this.partitionsFor(userId, ids),
    ]);
    const verified = new Set(
      verifications.flatMap(({ targetId }) => (targetId ? [targetId] : [])),
    );
    return candidates.filter(
      (message) =>
        !verified.has(message.id) &&
        partitionByMessage.get(message.id) !== HOLDOUT_PARTITION,
    );
  }

  private async reclassifyChunk({
    userId,
    chunk,
    structural,
    provenanceFor,
  }: {
    userId: string;
    chunk: readonly ReclassifiableMessage[];
    structural: EmailLabel;
    provenanceFor: (message: ReclassifiableMessage) => KnowledgeProvenance[];
  }): Promise<{ requeued: number; skipped: number }> {
    const previousStatus = new Map(
      chunk.map(({ id, processingStatus }) => [id, processingStatus]),
    );
    const claimToken = new Date();
    const claimed = await this.claimChunk({
      userId,
      messageIds: chunk.map(({ id }) => id),
      claimToken,
    });
    const plan = this.planChunk({ claimed, structural, provenanceFor });
    await this.persistChunk({
      userId,
      plan,
      claimToken,
      previousStatus,
    });
    return {
      requeued: plan.reclassified.length,
      skipped: plan.skippedIds.length,
    };
  }

  private planChunk({
    claimed,
    structural,
    provenanceFor,
  }: {
    claimed: readonly ReclassifiableMessage[];
    structural: EmailLabel;
    provenanceFor: (message: ReclassifiableMessage) => KnowledgeProvenance[];
  }): ChunkPlan {
    const reclassified = claimed.flatMap((message) => {
      const classification = mergedCandidateLabel({
        structural,
        current: message.classification,
      });
      if (!classification) {
        return [];
      }
      return [
        {
          message,
          classification,
          provenance: this.classificationProvenance(provenanceFor(message)),
        },
      ];
    });
    const reclassifiedIds = new Set(
      reclassified.map(({ message }) => message.id),
    );
    return {
      reclassified,
      skippedIds: claimed
        .filter(({ id }) => !reclassifiedIds.has(id))
        .map(({ id }) => id),
    };
  }

  private async persistChunk({
    userId,
    plan,
    claimToken,
    previousStatus,
  }: {
    userId: string;
    plan: ChunkPlan;
    claimToken: Date;
    previousStatus: ReadonlyMap<string, string>;
  }): Promise<void> {
    const classificationRows = plan.reclassified.flatMap(
      ({ message, classification, provenance }) =>
        buildClassificationRows({
          userId,
          messageId: message.id,
          classification,
          provenance,
        }),
    );
    const signalRecords = plan.reclassified.flatMap(
      ({ message, classification, provenance }) => {
        const records = buildFinanceSignal({
          userId,
          messageId: message.id,
          receivedAt: message.receivedAt,
          classification,
          provenance,
        });
        return records ? [records] : [];
      },
    );
    await this.prisma.$transaction([
      this.prisma.aiEmailClassification.deleteMany({
        where: {
          userId,
          messageId: {
            in: plan.reclassified.map(({ message }) => message.id),
          },
        },
      }),
      ...(classificationRows.length
        ? [
            this.prisma.aiEmailClassification.createMany({
              data: classificationRows,
            }),
          ]
        : []),
      ...plan.reclassified.map(({ message, classification }) =>
        this.prisma.aiEmailMessage.updateMany({
          where: {
            id: message.id,
            userId,
            processingStatus: 'CLASSIFYING',
            classificationStartedAt: claimToken,
          },
          data: {
            processingStatus: requiresReview({
              classification,
              auditSample: false,
            })
              ? 'REVIEW_REQUIRED'
              : 'PROCESSED',
            classificationStartedAt: null,
            classification: classificationLabel(classification),
            classificationPath: KNOWLEDGE_DECISION_PATH,
            classificationProvider: null,
            classificationModel: null,
          },
        }),
      ),
      ...plan.skippedIds.map((id) =>
        this.prisma.aiEmailMessage.updateMany({
          where: {
            id,
            userId,
            processingStatus: 'CLASSIFYING',
            classificationStartedAt: claimToken,
          },
          data: {
            processingStatus: (previousStatus.get(id) ??
              'REVIEW_REQUIRED') as Prisma.AiEmailMessageUpdateManyMutationInput['processingStatus'],
            classificationStartedAt: null,
          },
        }),
      ),
      ...(signalRecords.length
        ? [
            this.prisma.aiSignal.createMany({
              data: signalRecords.map(({ signal }) => signal),
              skipDuplicates: true,
            }),
            this.prisma.aiSignalEvidence.createMany({
              data: signalRecords.map(({ evidence }) => evidence),
              skipDuplicates: true,
            }),
            this.prisma.domainEventOutbox.createMany({
              data: signalRecords.map(({ outbox }) => outbox),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  }

  private async claimChunk({
    userId,
    messageIds,
    claimToken,
  }: {
    userId: string;
    messageIds: readonly string[];
    claimToken: Date;
  }): Promise<ReclassifiableMessage[]> {
    await this.prisma.aiEmailMessage.updateMany({
      where: {
        userId,
        id: { in: [...messageIds] },
        processingStatus: { in: [...RECLASSIFIABLE_STATUSES] },
      },
      data: {
        processingStatus: 'CLASSIFYING',
        classificationStartedAt: claimToken,
      },
    });
    return this.prisma.aiEmailMessage.findMany({
      where: {
        userId,
        id: { in: [...messageIds] },
        processingStatus: 'CLASSIFYING',
        classificationStartedAt: claimToken,
      },
      select: {
        id: true,
        receivedAt: true,
        fromAddress: true,
        subject: true,
        templateFingerprint: true,
        processingStatus: true,
        classification: true,
      },
    });
  }

  private async startRun({
    userId,
    trigger,
  }: {
    userId: string;
    trigger: string;
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
          reviewConfidenceThreshold: EMAIL_REVIEW_CONFIDENCE_THRESHOLD,
        },
      },
      select: { id: true },
    });
    return run.id;
  }

  private async completeRun({
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

  private async isHoldout(userId: string, messageId: string): Promise<boolean> {
    const partitions = await this.partitionsFor(userId, [messageId]);
    return partitions.get(messageId) === HOLDOUT_PARTITION;
  }

  private async partitionsFor(
    userId: string,
    messageIds: readonly string[],
  ): Promise<Map<string, string>> {
    const items = await this.prisma.aiDatasetItem.findMany({
      where: {
        userId,
        sourceType: EMAIL_SOURCE_TYPE,
        sourceId: { in: [...messageIds] },
      },
      select: { sourceId: true, partition: true },
    });
    const partitions = new Map(
      items.map(({ sourceId, partition }) => [sourceId, partition]),
    );
    for (const messageId of messageIds) {
      if (!partitions.has(messageId)) {
        partitions.set(messageId, partitionEmailDatasetItem(userId, messageId));
      }
    }
    return partitions;
  }

  private dominantGroupLabel(
    messages: readonly {
      receivedAt: Date;
      classification: Prisma.JsonValue | null;
    }[],
  ): EmailClassification | null {
    const entries = messages.flatMap(({ receivedAt, classification }) => {
      const current = currentClassificationLabel(classification);
      return current ? [{ classification: current, receivedAt }] : [];
    });
    return dominantClassification(entries);
  }

  private knowledgeScope(knowledge: KnowledgeRowRef): {
    where: Prisma.AiEmailMessageWhereInput;
    matches: (message: ReclassifiableMessage) => boolean;
  } | null {
    if (knowledge.knowledgeType === 'EMAIL_DOMAIN') {
      return {
        where: { fromDomain: knowledge.knowledgeKey },
        matches: () => true,
      };
    }
    if (knowledge.knowledgeType === 'EMAIL_SENDER') {
      const domain = knowledge.knowledgeKey.split('@')[1];
      if (!domain) {
        return null;
      }
      return {
        where: { fromDomain: domain },
        matches: (message) =>
          normalizeSender(message.fromAddress) === knowledge.knowledgeKey,
      };
    }
    if (knowledge.knowledgeType === 'EMAIL_TEMPLATE') {
      const domain = knowledge.knowledgeKey.split('|')[0];
      if (!domain) {
        return null;
      }
      return {
        where: { fromDomain: domain },
        matches: (message) =>
          knowledgeKeys(message.fromAddress, message.subject).some(
            ({ knowledgeType, knowledgeKey }) =>
              knowledgeType === 'EMAIL_TEMPLATE' &&
              knowledgeKey === knowledge.knowledgeKey,
          ),
      };
    }
    return null;
  }

  private classificationProvenance(
    matches: readonly KnowledgeProvenance[],
  ): ClassificationProvenance {
    return {
      method: KNOWLEDGE_DECISION_PATH,
      provider: null,
      model: null,
      auditSample: false,
      matches,
    };
  }

  private knowledgeLabel(payload: Prisma.JsonValue): unknown {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    return (payload as Record<string, unknown>).label ?? null;
  }
}
