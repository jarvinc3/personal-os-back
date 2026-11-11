import {
  admitsTransaction,
  tryValidateEmailClassification,
  type EmailClassification,
} from './email-classification.util';
import { knowledgeKeys } from '../knowledge/knowledge-normalizer';
import {
  KNOWLEDGE_PAYLOAD_SCHEMAS,
  type EmailLabel,
} from '../knowledge/knowledge-payload';

export const RECLASSIFIABLE_STATUSES = [
  'PROCESSED',
  'REVIEW_REQUIRED',
] as const;
export type ReclassifiableStatus = (typeof RECLASSIFIABLE_STATUSES)[number];

/** Límite por pasada: el resto queda pendiente para la siguiente verificación. */
export const RECLASSIFICATION_MAX_MESSAGES = 5_000;
export const RECLASSIFICATION_CLAIM_CHUNK_SIZE = 200;
export const RECLASSIFIED_CONFIDENCE = 0.98;

export type ReclassificationResult = {
  requeued: number;
};

export type KnowledgeProvenance = {
  knowledgeType: string;
  knowledgeKey: string;
  scope: 'USER' | 'GLOBAL';
};

const TRANSACTION_MONEY_FIELDS = [
  'amount',
  'currency',
  'transactionDate',
  'direction',
  'merchant',
  'bankReference',
  'last4',
  'accountNumberLast4',
  'movementClass',
  'bankStatusNormalized',
  'statusConfidence',
  'statusEvidence',
  'reverseOfBankReference',
  'reverseOfEmailMessageId',
  'suggestedTransactionDate',
  'suggestedTransactionDateSource',
  'receivedAmount',
  'transferExchangeRate',
  'categoryNameHint',
] as const;

export function isReclassifiableStatus(
  status: string,
): status is ReclassifiableStatus {
  return (RECLASSIFIABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Solo la parte estructural de una etiqueta verificada. El monto, la moneda y
 * la cuenta viajan por mensaje: copiarlos de un correo a otro inventaría dinero.
 */
export function structuralLabel(value: unknown): EmailLabel | null {
  if (!isRecord(value)) {
    return null;
  }
  const transaction = isRecord(value.transaction) ? value.transaction : null;
  const projected = {
    ...(typeof value.relevance === 'boolean'
      ? { relevance: value.relevance }
      : {}),
    ...(typeof value.semanticType === 'string'
      ? { semanticType: value.semanticType }
      : {}),
    ...(Array.isArray(value.routes)
      ? { routes: value.routes.filter(isString) }
      : {}),
    ...(transaction && typeof transaction.kind === 'string'
      ? { transaction: { kind: transaction.kind } }
      : {}),
  };
  const parsed = KNOWLEDGE_PAYLOAD_SCHEMAS.EMAIL_TEMPLATE.safeParse({
    label: projected,
  });
  return parsed.success ? parsed.data.label : null;
}

/** Etiqueta actual de un mensaje ya clasificado, validada con las reglas cerradas. */
export function currentClassificationLabel(
  value: unknown,
): EmailClassification | null {
  if (!isRecord(value)) {
    return null;
  }
  const transaction = isRecord(value.transaction)
    ? transactionEvidence(value.transaction)
    : null;
  return tryValidateEmailClassification({
    relevance: value.relevance,
    semanticType: value.semanticType,
    routes: value.routes,
    ...(transaction ? { transaction } : {}),
    confidence:
      typeof value.confidence === 'number'
        ? value.confidence
        : RECLASSIFIED_CONFIDENCE,
  });
}

/**
 * Aplica la estructura verificada y conserva el monto, la moneda y la cuenta
 * que el mensaje ya había extraído. Sin datos propios, la señal llega a Finance
 * y allí queda en revisión en lugar de inventar un movimiento.
 */
export function mergedCandidateLabel({
  structural,
  current,
}: {
  structural: EmailLabel;
  current: unknown;
}): EmailClassification | null {
  const money =
    structural.relevance !== false &&
    admitsTransaction(structural.semanticType) &&
    isRecord(current) &&
    isRecord(current.transaction)
      ? transactionMoney(current.transaction)
      : null;
  const structuralTransaction = structural.transaction;
  const transaction =
    structuralTransaction || money
      ? { ...(money ?? {}), ...(structuralTransaction ?? {}) }
      : null;
  return tryValidateEmailClassification({
    relevance: structural.relevance,
    semanticType: structural.semanticType,
    routes: structural.routes,
    ...(transaction ? { transaction } : {}),
    confidence: RECLASSIFIED_CONFIDENCE,
  });
}

/** Etiqueta confirmada de un grupo: la más repetida; un empate gana la más reciente. */
export function dominantClassification(
  entries: readonly { classification: EmailClassification; receivedAt: Date }[],
): EmailClassification | null {
  if (!entries.length) {
    return null;
  }
  const groups = new Map<
    string,
    { classification: EmailClassification; count: number; latest: Date }
  >();
  for (const entry of entries) {
    const key = JSON.stringify(entry.classification);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        classification: entry.classification,
        count: 1,
        latest: entry.receivedAt,
      });
      continue;
    }
    group.count += 1;
    if (entry.receivedAt > group.latest) {
      group.latest = entry.receivedAt;
    }
  }
  const ranked = [...groups.values()].sort(
    (left, right) =>
      right.count - left.count ||
      right.latest.getTime() - left.latest.getTime(),
  );
  return ranked[0]?.classification ?? null;
}

/** Claves que la verificación del mensaje comparte con el candidato. */
export function sharedKnowledgeProvenance({
  verified,
  candidate,
}: {
  verified: { fromAddress: string; subject: string };
  candidate: { fromAddress: string; subject: string };
}): KnowledgeProvenance[] {
  const candidateKeys = new Set(
    knowledgeKeys(candidate.fromAddress, candidate.subject).map(
      ({ knowledgeType, knowledgeKey }) => `${knowledgeType}|${knowledgeKey}`,
    ),
  );
  return knowledgeKeys(verified.fromAddress, verified.subject)
    .filter(({ knowledgeType, knowledgeKey }) =>
      candidateKeys.has(`${knowledgeType}|${knowledgeKey}`),
    )
    .map(({ knowledgeType, knowledgeKey }) => ({
      knowledgeType,
      knowledgeKey,
      scope: 'USER' as const,
    }));
}

/** El grupo verificado cubre todas las claves del propio mensaje. */
export function messageKnowledgeProvenance(message: {
  fromAddress: string;
  subject: string;
}): KnowledgeProvenance[] {
  return knowledgeKeys(message.fromAddress, message.subject).map(
    ({ knowledgeType, knowledgeKey }) => ({
      knowledgeType,
      knowledgeKey,
      scope: 'USER' as const,
    }),
  );
}

export function knowledgeProvenanceForRow(knowledge: {
  knowledgeType: string;
  knowledgeKey: string;
  scope: string;
}): KnowledgeProvenance[] {
  return [
    {
      knowledgeType: knowledge.knowledgeType,
      knowledgeKey: knowledge.knowledgeKey,
      scope: knowledge.scope === 'GLOBAL' ? 'GLOBAL' : 'USER',
    },
  ];
}

/** Un rechazo verificado deja el remitente como no relevante. */
export function verificationLabel({
  verdict,
  correctedPayload,
}: {
  verdict: string;
  correctedPayload: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  if (verdict === 'REJECTED') {
    return { relevance: false, semanticType: 'OTHER', routes: [] };
  }
  return correctedPayload;
}

function transactionEvidence(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(typeof value.kind === 'string' ? { kind: value.kind } : {}),
    ...transactionMoney(value),
  };
}

function transactionMoney(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    TRANSACTION_MONEY_FIELDS.filter((field) => value[field] !== undefined).map(
      (field) => [field, value[field]],
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
