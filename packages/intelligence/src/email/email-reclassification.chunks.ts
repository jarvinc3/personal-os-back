import type { Prisma, PrismaService } from '@personal-os/database';
import type { EmailLabel } from '../knowledge/knowledge-payload';
import {
  buildClassificationRows,
  buildFinanceSignal,
  classificationLabel,
  requiresReview,
  type ClassificationProvenance,
} from './email-classification-persistence';
import type { EmailClassification } from './email-classification.util';
import type { EmailReviewSettings } from './email-review-settings';
import type {
  ChunkPlan,
  ReclassifiableMessage,
  ReclassifiedMessage,
} from './email-reclassification.types';
import {
  mergedCandidateLabel,
  RECLASSIFIABLE_STATUSES,
  type KnowledgeProvenance,
} from './email-reclassification.util';

const KNOWLEDGE_DECISION_PATH = 'KNOWLEDGE';
/** Un bloque encola hasta 200 actualizaciones de mensaje dentro de la transacción. */
const RECLASSIFICATION_TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * Escribe un bloque ya reclamado: plan, transacción, asentado por correo,
 * reemplazo de clasificaciones y publicación de señales.
 */
export class EmailReclassificationChunks {
  constructor(private readonly prisma: PrismaService) {}

  async reclassifyChunk({
    userId,
    chunk,
    structural,
    provenanceFor,
    reviewSettings,
    verifiedSender,
  }: {
    userId: string;
    chunk: readonly ReclassifiableMessage[];
    structural: EmailLabel;
    provenanceFor: (message: ReclassifiableMessage) => KnowledgeProvenance[];
    reviewSettings: EmailReviewSettings;
    verifiedSender: boolean;
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
    if (!claimed.length) {
      return { requeued: 0, skipped: 0 };
    }
    try {
      const plan = this.planChunk({ claimed, structural, provenanceFor });
      return await this.persistChunk({
        userId,
        plan,
        claimToken,
        previousStatus,
        reviewSettings,
        verifiedSender,
      });
    } catch (error) {
      await this.releaseChunk({
        userId,
        messageIds: claimed.map(({ id }) => id),
        claimToken,
        previousStatus,
      });
      throw error;
    }
  }

  /** Un fallo a mitad de bloque no puede dejar correos atrapados en CLASSIFYING. */
  async releaseChunk({
    userId,
    messageIds,
    claimToken,
    previousStatus,
  }: {
    userId: string;
    messageIds: readonly string[];
    claimToken: Date;
    previousStatus: ReadonlyMap<string, string>;
  }): Promise<void> {
    for (const status of RECLASSIFIABLE_STATUSES) {
      const ids = messageIds.filter((id) => previousStatus.get(id) === status);
      if (!ids.length) {
        continue;
      }
      await this.prisma.aiEmailMessage.updateMany({
        where: {
          userId,
          id: { in: ids },
          processingStatus: 'CLASSIFYING',
          classificationStartedAt: claimToken,
        },
        data: { processingStatus: status, classificationStartedAt: null },
      });
    }
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

  /**
   * La propiedad se comprueba con una escritura guardada y bloqueada dentro de
   * la misma transacción: si otro escritor reclamó el mensaje, este pase no
   * toca sus clasificaciones ni publica señales por él.
   */
  private async persistChunk({
    userId,
    plan,
    claimToken,
    previousStatus,
    reviewSettings,
    verifiedSender,
  }: {
    userId: string;
    plan: ChunkPlan;
    claimToken: Date;
    previousStatus: ReadonlyMap<string, string>;
    reviewSettings: EmailReviewSettings;
    verifiedSender: boolean;
  }): Promise<{ requeued: number; skipped: number }> {
    return this.prisma.$transaction(
      async (tx) => {
        const owned = await this.applyChunkOutcomes({
          tx,
          userId,
          plan,
          claimToken,
          previousStatus,
          reviewSettings,
          verifiedSender,
        });
        if (!owned.reclassified.length && !owned.skippedIds.length) {
          return { requeued: 0, skipped: 0 };
        }
        await this.replaceClassifications({
          tx,
          userId,
          reclassified: owned.reclassified,
        });
        await this.publishSignals({
          tx,
          userId,
          reclassified: owned.reclassified,
        });
        return {
          requeued: owned.reclassified.length,
          skipped: owned.skippedIds.length,
        };
      },
      { timeout: RECLASSIFICATION_TRANSACTION_TIMEOUT_MS },
    );
  }

  /** Devuelve solo lo que este pase todavía posee; el resto lo resuelve su dueño. */
  private async applyChunkOutcomes({
    tx,
    userId,
    plan,
    claimToken,
    previousStatus,
    reviewSettings,
    verifiedSender,
  }: {
    tx: Prisma.TransactionClient;
    userId: string;
    plan: ChunkPlan;
    claimToken: Date;
    previousStatus: ReadonlyMap<string, string>;
    reviewSettings: EmailReviewSettings;
    verifiedSender: boolean;
  }): Promise<ChunkPlan> {
    const reclassified: ReclassifiedMessage[] = [];
    for (const entry of plan.reclassified) {
      const owned = await this.settleMessage({
        tx,
        userId,
        messageId: entry.message.id,
        claimToken,
        data: this.reclassifiedMessageData(
          entry.classification,
          reviewSettings,
          verifiedSender,
        ),
      });
      if (owned) {
        reclassified.push(entry);
      }
    }
    const skippedIds: string[] = [];
    for (const id of plan.skippedIds) {
      const owned = await this.settleMessage({
        tx,
        userId,
        messageId: id,
        claimToken,
        data: {
          processingStatus: (previousStatus.get(id) ??
            'REVIEW_REQUIRED') as Prisma.AiEmailMessageUpdateManyMutationInput['processingStatus'],
          classificationStartedAt: null,
        },
      });
      if (owned) {
        skippedIds.push(id);
      }
    }
    return { reclassified, skippedIds };
  }

  private async settleMessage({
    tx,
    userId,
    messageId,
    claimToken,
    data,
  }: {
    tx: Prisma.TransactionClient;
    userId: string;
    messageId: string;
    claimToken: Date;
    data: Prisma.AiEmailMessageUpdateManyMutationInput;
  }): Promise<boolean> {
    const settled = await tx.aiEmailMessage.updateMany({
      where: {
        id: messageId,
        userId,
        processingStatus: 'CLASSIFYING',
        classificationStartedAt: claimToken,
      },
      data,
    });
    return settled.count === 1;
  }

  private reclassifiedMessageData(
    classification: EmailClassification,
    reviewSettings: EmailReviewSettings,
    verifiedSender: boolean,
  ): Prisma.AiEmailMessageUpdateManyMutationInput {
    return {
      processingStatus: requiresReview({
        classification,
        auditSample: false,
        reviewConfidenceThreshold: reviewSettings.reviewConfidenceThreshold,
        verifiedSender,
        acceptVerifiedSenders: reviewSettings.acceptVerifiedSenders,
      })
        ? 'REVIEW_REQUIRED'
        : 'PROCESSED',
      classificationStartedAt: null,
      classification: {
        ...classificationLabel(classification),
        confidence: classification.confidence,
      },
      classificationPath: KNOWLEDGE_DECISION_PATH,
      classificationProvider: null,
      classificationModel: null,
    };
  }

  private async replaceClassifications({
    tx,
    userId,
    reclassified,
  }: {
    tx: Prisma.TransactionClient;
    userId: string;
    reclassified: readonly ReclassifiedMessage[];
  }): Promise<void> {
    await tx.aiEmailClassification.deleteMany({
      where: {
        userId,
        messageId: { in: reclassified.map(({ message }) => message.id) },
      },
    });
    const rows = reclassified.flatMap(
      ({ message, classification, provenance }) =>
        buildClassificationRows({
          userId,
          messageId: message.id,
          classification,
          provenance,
        }),
    );
    if (!rows.length) {
      return;
    }
    await tx.aiEmailClassification.createMany({ data: rows });
  }

  private async publishSignals({
    tx,
    userId,
    reclassified,
  }: {
    tx: Prisma.TransactionClient;
    userId: string;
    reclassified: readonly ReclassifiedMessage[];
  }): Promise<void> {
    const records = reclassified.flatMap(
      ({ message, classification, provenance }) => {
        const built = buildFinanceSignal({
          userId,
          messageId: message.id,
          receivedAt: message.receivedAt,
          classification,
          provenance,
        });
        return built ? [built] : [];
      },
    );
    if (!records.length) {
      return;
    }
    await tx.aiSignal.createMany({
      data: records.map(({ signal }) => signal),
      skipDuplicates: true,
    });
    await tx.aiSignalEvidence.createMany({
      data: records.map(({ evidence }) => evidence),
      skipDuplicates: true,
    });
    await tx.domainEventOutbox.createMany({
      data: records.map(({ outbox }) => outbox),
      skipDuplicates: true,
    });
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
    return this.prisma.aiEmailMessage.updateManyAndReturn({
      where: {
        userId,
        id: { in: [...messageIds] },
        processingStatus: { in: [...RECLASSIFIABLE_STATUSES] },
      },
      data: {
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
}
