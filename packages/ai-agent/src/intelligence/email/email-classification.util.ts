import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { JsonObject } from '@personal-os/contracts';
import {
  SEMANTIC_ROUTES,
  SEMANTIC_TYPES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_KINDS,
} from '../evidence/human-verification.constants';
import type { SemanticRoute } from '../evidence/human-verification.constants';

const transactionSchema = z
  .strictObject({
    kind: z.enum(TRANSACTION_KINDS).optional(),
    amount: z.number().positive().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    transactionDate: z.iso.datetime().optional(),
    direction: z.enum(TRANSACTION_DIRECTIONS).optional(),
    merchant: z.string().trim().min(1).max(160).optional(),
    bankReference: z.string().trim().min(1).max(120).optional(),
    last4: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
  })
  .optional();

const classificationSchema = z.strictObject({
  relevance: z.boolean(),
  semanticType: z.enum(SEMANTIC_TYPES),
  routes: z.array(z.enum(SEMANTIC_ROUTES)).max(SEMANTIC_ROUTES.length),
  transaction: transactionSchema,
  confidence: z.number().min(0).max(1),
});

export type EmailClassification = z.infer<typeof classificationSchema>;
export type ClassificationLabels = Omit<EmailClassification, 'confidence'>;

export const EMAIL_CLASSIFICATION_JSON_SCHEMA = z.toJSONSchema(
  classificationSchema,
  { target: 'draft-07', unrepresentable: 'any' },
) as JsonObject;

const REQUIRED_ROUTES: Partial<
  Record<EmailClassification['semanticType'], string>
> = {
  FIN_TRANSACTION: 'FINANCE',
  PURCHASE_RECEIPT: 'FINANCE',
  FIN_STATEMENT_NOTICE: 'FINANCE',
  FIN_ACCOUNT_NOTICE: 'FINANCE',
  SUBSCRIPTION_BILLING: 'SUBSCRIPTIONS',
  CALENDAR_EVENT: 'CALENDAR',
  SECURITY_OTP: 'SECURITY',
  SECURITY_ALERT: 'SECURITY',
};

/** Revalidates model, knowledge and parser output against closed business rules. */
export function validateEmailClassification(
  value: unknown,
): EmailClassification {
  const parsed = classificationSchema.parse(value);
  if (new Set(parsed.routes).size !== parsed.routes.length) {
    throw new Error('duplicate classification route');
  }
  if (parsed.semanticType === 'FIN_TRANSACTION' && !parsed.transaction?.kind) {
    throw new Error('financial transaction requires a transaction kind');
  }
  if (
    (parsed.semanticType === 'PURCHASE_RECEIPT' ||
      parsed.semanticType === 'SUBSCRIPTION_BILLING') &&
    parsed.transaction?.kind
  ) {
    throw new Error('receipt classification cannot set a transaction kind');
  }
  if (
    parsed.transaction &&
    !['FIN_TRANSACTION', 'PURCHASE_RECEIPT', 'SUBSCRIPTION_BILLING'].includes(
      parsed.semanticType,
    )
  ) {
    throw new Error('transaction data is not valid for this semantic type');
  }
  if (parsed.semanticType === 'SECURITY_ALERT' && !parsed.relevance) {
    throw new Error('security alert must be relevant');
  }
  if (parsed.semanticType === 'SECURITY_OTP' && parsed.relevance) {
    throw new Error('one-time codes are not financial-relevant');
  }
  const requiredRoute = REQUIRED_ROUTES[parsed.semanticType];
  if (
    requiredRoute &&
    !parsed.routes.includes(requiredRoute as SemanticRoute)
  ) {
    throw new Error('classification is missing its required route');
  }
  return parsed;
}

export function parseDeterministicEmail(input: {
  subject: string;
  body: string;
  knownLabel?: Record<string, unknown> | null;
}): EmailClassification | null {
  if (input.knownLabel) {
    const label = input.knownLabel;
    const semanticType = SEMANTIC_TYPES.includes(
      label.semanticType as (typeof SEMANTIC_TYPES)[number],
    )
      ? (label.semanticType as (typeof SEMANTIC_TYPES)[number])
      : 'OTHER';
    const routes = Array.isArray(label.routes)
      ? label.routes.filter(
          (route): route is (typeof SEMANTIC_ROUTES)[number] =>
            SEMANTIC_ROUTES.includes(route as (typeof SEMANTIC_ROUTES)[number]),
        )
      : [];
    const candidate = {
      relevance: typeof label.relevance === 'boolean' ? label.relevance : false,
      semanticType,
      routes,
      ...(label.transaction && typeof label.transaction === 'object'
        ? { transaction: label.transaction }
        : {}),
      confidence:
        label.semanticType && Array.isArray(label.routes) ? 0.98 : 0.55,
    };
    try {
      return validateEmailClassification(candidate);
    } catch {
      return {
        relevance: candidate.relevance,
        semanticType: 'OTHER',
        routes: [],
        confidence: 0.55,
      };
    }
  }

  const text = `${input.subject}\n${input.body}`;
  const lower = text.toLocaleLowerCase('en');
  if (
    /\b(one[- ]time|verification|security) code\b|\b(?:otp|c[oó]digo de (?:verificaci[oó]n|un solo uso))\b/i.test(
      lower,
    ) &&
    /\b\d{4,8}\b/.test(text)
  ) {
    return {
      relevance: false,
      semanticType: 'SECURITY_OTP',
      routes: ['SECURITY'],
      confidence: 0.99,
    };
  }
  if (
    /\b(unauthorized sign[- ]in|new sign[- ]in|security alert|inicio de sesi[oó]n no reconocido|alerta de seguridad)\b/i.test(
      lower,
    )
  ) {
    return {
      relevance: true,
      semanticType: 'SECURITY_ALERT',
      routes: ['SECURITY'],
      confidence: 0.96,
    };
  }
  return null;
}

export function isRecallAuditSample(messageId: string, rate = 100): boolean {
  if (!Number.isInteger(rate) || rate < 1) {
    return false;
  }
  const bucket = createHash('sha256')
    .update(messageId)
    .digest()
    .readUInt32BE(0);
  return bucket % rate === 0;
}

export const EMAIL_CLASSIFICATION_VERSIONS = {
  pipeline: 'email-classification-v1',
  detector: 'email-relevance-detector-v1',
  prompt: 'email-classification-prompt-v1',
  schema: 'email-classification-schema-v1',
  parser: 'known-template-parser-v1',
} as const;
