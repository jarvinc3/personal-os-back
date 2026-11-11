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
  reviewConfidenceThreshold = EMAIL_REVIEW_CONFIDENCE_THRESHOLD,
  isHoldout = false,
  verifiedSender = false,
  acceptVerifiedSenders = false,
}: {
  classification: EmailClassification;
  auditSample: boolean;
  reviewConfidenceThreshold?: number;
  isHoldout?: boolean;
  verifiedSender?: boolean;
  acceptVerifiedSenders?: boolean;
}): boolean {
  if (auditSample) {
    return true;
  }
  if (!isHoldout && verifiedSender && acceptVerifiedSenders) {
    return false;
  }
  const threshold = isHoldout
    ? EMAIL_REVIEW_CONFIDENCE_THRESHOLD
    : reviewConfidenceThreshold;
  return classification.confidence < threshold;
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

export type FinanceSignalRecords = {
  signal: Prisma.AiSignalCreateManyInput;
  evidence: Prisma.AiSignalEvidenceCreateManyInput;
  outbox: Prisma.DomainEventOutboxCreateManyInput;
};

export function buildFinanceSignal({
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
}): FinanceSignalRecords | null {
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
