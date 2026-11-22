import type { Prisma } from '@personal-os/database';
import type { EmailClassification } from './email-classification.util';

export type ModelBudget = 'reserve' | 'inspect';

export type KnowledgeMatch = {
  id: string;
  knowledgeType: string;
  knowledgeKey: string;
  scope: 'USER' | 'GLOBAL';
  payload: Prisma.JsonValue;
};

export type ClassificationMethod = 'KNOWLEDGE' | 'DETERMINISTIC' | 'MODEL';

export type KnowledgeRef = {
  knowledgeType: string;
  knowledgeKey: string;
  scope: 'USER' | 'GLOBAL';
};

export type ClassifiableMessage = {
  id: string;
  receivedAt: Date;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  templateFingerprint: string | null;
  processingStatus: string;
  content: { sanitizedBody: string | null } | null;
};

export type ComputedClassification =
  | {
      kind: 'computed';
      classification: EmailClassification;
      method: ClassificationMethod;
      provider: string | null;
      model: string | null;
      auditSample: boolean;
      matches: KnowledgeMatch[];
      verifiedSender: boolean;
    }
  | { kind: 'budget_exhausted' }
  | { kind: 'rate_limited' }
  | { kind: 'no_classification' };

/** Resultado de clasificar un correo concreto, con o sin escritura. */
export type MessageClassificationResult =
  | {
      kind: 'classified';
      classification: EmailClassification;
      method: ClassificationMethod;
      provider: string | null;
      model: string | null;
      auditSample: boolean;
      knowledgeUsed: KnowledgeRef[];
    }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: string };
