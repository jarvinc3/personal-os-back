import { z } from 'zod';
import {
  SEMANTIC_ROUTES,
  SEMANTIC_TYPES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_KINDS,
} from '../evidence/human-verification.constants';

export const SANITIZER_VERSION = 'global-knowledge-sanitizer-v1';

const structuralLabel = z.strictObject({
  relevance: z.boolean().optional(),
  semanticType: z.enum(SEMANTIC_TYPES).optional(),
  routes: z.array(z.enum(SEMANTIC_ROUTES)).optional(),
  transaction: z.strictObject({ kind: z.enum(TRANSACTION_KINDS) }).optional(),
});

const userLabel = structuralLabel.extend({
  transaction: z
    .strictObject({
      kind: z.enum(TRANSACTION_KINDS).optional(),
      amount: z.number().positive().optional(),
      currency: z.string().length(3).optional(),
      transactionDate: z.iso.datetime().optional(),
      direction: z.enum(TRANSACTION_DIRECTIONS).optional(),
      merchant: z.string().optional(),
      bankReference: z.string().optional(),
      last4: z
        .string()
        .regex(/^\d{4}$/)
        .optional(),
    })
    .optional(),
});

const emailPayload = z.strictObject({ label: userLabel });
const globalEmailPayload = z.strictObject({ label: structuralLabel });

export const KNOWLEDGE_PAYLOAD_SCHEMAS = {
  EMAIL_SENDER: emailPayload,
  EMAIL_DOMAIN: emailPayload,
  EMAIL_TEMPLATE: emailPayload,
  ENTITY: z.strictObject({ entityType: z.string(), name: z.string() }),
  RELATION: z.strictObject({
    from: z.string(),
    to: z.string(),
    relation: z.string(),
  }),
  USER_MAPPING: z.strictObject({
    externalHintHash: z.string(),
    targetId: z.string(),
  }),
} as const;

export type EmailLabel = z.infer<typeof userLabel>;
export type StructuralLabel = z.infer<typeof structuralLabel>;

export function parseUserEmailPayload(value: unknown): { label: EmailLabel } {
  return emailPayload.parse(value);
}

/** Constructs an allowlisted payload; the source object is never spread. */
export function sanitizeGlobalLabel(value: unknown): {
  label: StructuralLabel;
} {
  const parsed = userLabel.parse(value);
  const candidate = {
    ...(parsed.relevance === undefined ? {} : { relevance: parsed.relevance }),
    ...(parsed.semanticType ? { semanticType: parsed.semanticType } : {}),
    ...(parsed.routes ? { routes: [...parsed.routes].sort() } : {}),
    ...(parsed.transaction?.kind
      ? { transaction: { kind: parsed.transaction.kind } }
      : {}),
  };
  return globalEmailPayload.parse({ label: candidate });
}

export function isSafeGlobalPayload(value: unknown): boolean {
  return globalEmailPayload.safeParse(value).success;
}
