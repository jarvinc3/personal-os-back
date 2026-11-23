import type { Prisma } from '@personal-os/database';
import type { EmailLabel } from '../knowledge/knowledge-payload';
import type { ClassificationProvenance } from './email-classification-persistence';
import type { EmailClassification } from './email-classification.util';
import type { KnowledgeProvenance } from './email-reclassification.util';

export type KnowledgeRowRef = {
  knowledgeType: string;
  knowledgeKey: string;
  scope: string;
  payload: Prisma.JsonValue;
};

export type ReclassifiableMessage = {
  id: string;
  receivedAt: Date;
  fromAddress: string;
  subject: string;
  templateFingerprint: string | null;
  processingStatus: string;
  classification: Prisma.JsonValue | null;
};

export type ReclassifiedMessage = {
  message: ReclassifiableMessage;
  classification: EmailClassification;
  provenance: ClassificationProvenance;
};

export type ChunkPlan = {
  reclassified: ReclassifiedMessage[];
  skippedIds: string[];
};

export type ReclassifyScopeInput = {
  userId: string;
  where: Prisma.AiEmailMessageWhereInput;
  matches: (message: ReclassifiableMessage) => boolean;
  structural: EmailLabel;
  provenanceFor: (message: ReclassifiableMessage) => KnowledgeProvenance[];
  trigger: string;
  verifiedSender?: boolean;
};
