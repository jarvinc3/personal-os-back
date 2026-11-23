import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  MODULE_SETTINGS_READER,
  type ModuleSettingsReader,
} from '@personal-os/contracts';
import { PrismaService, type Prisma } from '@personal-os/database';
import { HOLDOUT_PARTITION } from '../evidence/email-evidence.constants';
import {
  knowledgeKeys,
  normalizeSender,
} from '../knowledge/knowledge-normalizer';
import type { EmailClassification } from './email-classification.util';
import { EmailReclassificationChunks } from './email-reclassification.chunks';
import { EmailReclassificationEngine } from './email-reclassification.engine';
import { readEmailPartitions } from './email-reclassification.partitions';
import { EmailReclassificationRuns } from './email-reclassification.runs';
import type {
  KnowledgeRowRef,
  ReclassifiableMessage,
} from './email-reclassification.types';
import {
  currentClassificationLabel,
  dominantClassification,
  knowledgeProvenanceForRow,
  RECLASSIFIABLE_STATUSES,
  sharedKnowledgeProvenance,
  structuralLabel,
  type ReclassificationResult,
} from './email-reclassification.util';

export type { KnowledgeRowRef } from './email-reclassification.types';

@Injectable()
export class AiEmailReclassificationService {
  private readonly logger = new Logger(AiEmailReclassificationService.name);
  private readonly runs: EmailReclassificationRuns;
  private readonly chunks: EmailReclassificationChunks;
  private readonly engine: EmailReclassificationEngine;

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(MODULE_SETTINGS_READER)
    private readonly moduleSettings?: ModuleSettingsReader,
  ) {
    this.runs = new EmailReclassificationRuns({
      prisma: this.prisma,
      logger: this.logger,
    });
    this.chunks = new EmailReclassificationChunks(this.prisma);
    this.engine = new EmailReclassificationEngine({
      prisma: this.prisma,
      runs: this.runs,
      chunks: this.chunks,
      logger: this.logger,
      moduleSettings: this.moduleSettings,
    });
  }

  /**
   * La verificación de un correo solo cubre su plantilla. Se aplica a los demás
   * correos del mismo remitente y la misma huella, nunca al verificado, a otra
   * plantilla ni a HOLDOUT. Sin huella no se generaliza.
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
        templateFingerprint: true,
        classification: true,
      },
    });
    if (!verified || !verified.templateFingerprint) {
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
    return this.engine.run({
      userId,
      where: {
        fromAddress: verified.fromAddress,
        templateFingerprint: verified.templateFingerprint,
      },
      matches: () => true,
      structural,
      provenanceFor: (candidate) =>
        sharedKnowledgeProvenance({ verified, candidate }),
      trigger: 'MESSAGE_VERIFICATION',
      verifiedSender: true,
    });
  }

  /**
   * El lote confirma un remitente y una plantilla. Solo se reclasifican los
   * correos de esa misma huella; una huella nula no se generaliza.
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
    if (!templateFingerprint) {
      return { requeued: 0 };
    }
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
    const partitions = await readEmailPartitions({
      prisma: this.prisma,
      userId,
      messageIds: groupMessages.map(({ id }) => id),
    });
    const labelledGroup = groupMessages.filter(
      ({ id }) => partitions.get(id) !== HOLDOUT_PARTITION,
    );
    const structural = structuralLabel(
      correctedLabel ?? this.dominantGroupLabel(labelledGroup),
    );
    if (!structural) {
      return { requeued: 0 };
    }
    return this.engine.run({
      userId,
      where: { fromAddress, templateFingerprint },
      matches: () => true,
      structural,
      provenanceFor: (candidate) =>
        sharedKnowledgeProvenance({ verified: representative, candidate }),
      trigger: 'GROUP_VERIFICATION',
      verifiedSender: true,
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
    return this.engine.run({
      userId,
      where: scope.where,
      matches: scope.matches,
      structural,
      provenanceFor: () => knowledgeProvenanceForRow(knowledge),
      trigger: 'KNOWLEDGE_PROMOTION',
      verifiedSender:
        knowledge.scope === 'USER' &&
        knowledge.knowledgeType === 'EMAIL_SENDER',
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
    const eligible = await this.engine.eligibleMessages({
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

  private async isHoldout(userId: string, messageId: string): Promise<boolean> {
    const partitions = await readEmailPartitions({
      prisma: this.prisma,
      userId,
      messageIds: [messageId],
    });
    return partitions.get(messageId) === HOLDOUT_PARTITION;
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

  private knowledgeLabel(payload: Prisma.JsonValue): unknown {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    return (payload as Record<string, unknown>).label ?? null;
  }
}
