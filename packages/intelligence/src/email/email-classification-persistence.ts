import { Prisma } from '@personal-os/database';
import type { EmailClassification } from './email-classification.util';

export const EMAIL_REVIEW_CONFIDENCE_THRESHOLD = 0.7;

export type KnowledgeMatchRef = {
  knowledgeType: string;
  knowledgeKey: string;
  scope: 'USER' | 'GLOBAL';
};

export type ClassificationProvenance = {
  method: 'KNOWLEDGE' | 'DETERMINISTIC' | 'MODEL';
  provider: string | null;
  model: string | null;
  auditSample: boolean;
  matches: readonly KnowledgeMatchRef[];
};

export function classificationLabel(classification: EmailClassification) {
  return {
    relevance: classification.relevance,
    semanticType: classification.semanticType,
    routes: classification.routes,
    ...(classification.transaction
      ? { transaction: classification.transaction }
      : {}),
  };
}

export function knowledgeUsedRefs(
  matches: readonly KnowledgeMatchRef[],
): Prisma.InputJsonObject[] {
  return matches.map(({ knowledgeType, knowledgeKey, scope }) => ({
    knowledgeType,
    knowledgeKey,
    scope,
  }));
}

export function publishesFinanceSignal(
  classification: EmailClassification,
): boolean {
  return (
    classification.relevance &&
    classification.routes.includes('FINANCE') &&
    Boolean(classification.transaction)
  );
}

export function requiresReview({
  classification,
  auditSample,
}: {
  classification: EmailClassification;
  auditSample: boolean;
}): boolean {
  return (
    auditSample || classification.confidence < EMAIL_REVIEW_CONFIDENCE_THRESHOLD
  );
}

export function buildClassificationRows({
  userId,
  messageId,
  classification,
  provenance,
}: {
  userId: string;
  messageId: string;
  classification: EmailClassification;
  provenance: ClassificationProvenance;
}): Prisma.AiEmailClassificationCreateManyInput[] {
  const routes: Array<string | null> = classification.routes.length
    ? classification.routes
    : [null];
  const knowledgeUsed = knowledgeUsedRefs(provenance.matches);
  return routes.map((route) => ({
    userId,
    messageId,
    route: route ?? 'NONE',
    relevance: classification.relevance,
    semanticType: classification.semanticType,
    transaction: classification.transaction
      ? classification.transaction
      : Prisma.JsonNull,
    confidence: classification.confidence,
    decisionPath: provenance.method,
    knowledgeUsed,
    provider: provenance.provider,
    model: provenance.model,
  }));
}

export function buildSignalWrites({
  userId,
  messageId,
  receivedAt,
  classification,
  provenance,
}: {
  userId: string;
  messageId: string;
  receivedAt: Date;
  classification: EmailClassification;
  provenance: ClassificationProvenance;
}): {
  signal: Prisma.AiSignalCreateManyInput;
  evidence: Prisma.AiSignalEvidenceCreateManyInput;
  outbox: Prisma.DomainEventOutboxCreateManyInput;
} | null {
  if (!publishesFinanceSignal(classification)) {
    return null;
  }
  const signalId = `email-${messageId}`;
  return {
    signal: {
      id: signalId,
      userId,
      type: 'FINANCE.TRANSACTION_DETECTED',
      domain: 'FINANCE',
      sourceType: 'EMAIL_MESSAGE',
      sourceId: messageId,
      payload: {
        relevance: classification.relevance,
        semanticType: classification.semanticType,
        transaction: classification.transaction ?? null,
        confidence: classification.confidence,
        routes: classification.routes,
        messageId,
      } satisfies Prisma.InputJsonValue,
      status: 'ROUTED',
      priority: Math.round(classification.confidence * 100),
      confidence: classification.confidence,
      occurredAt: receivedAt,
      deduplicationKey: `EMAIL_MESSAGE:${messageId}`,
      correlationKey: `${userId}:email:${messageId}`,
    },
    evidence: {
      userId,
      signalId,
      sourceType: 'EMAIL_CLASSIFICATION',
      sourceId: messageId,
      excerpt: {
        semanticType: classification.semanticType,
        route: 'FINANCE',
        confidence: classification.confidence,
        transaction: classification.transaction,
        classificationPath: provenance.method,
        inferenceProvider: provenance.provider,
        inferenceModel: provenance.model,
      },
    },
    outbox: {
      eventId: `ai.signal.routed:${signalId}`,
      eventName: 'ai.signal.routed',
      aggregateType: 'AiSignal',
      aggregateId: signalId,
      userId,
      payload: { signalId, userId },
    },
  };
}
