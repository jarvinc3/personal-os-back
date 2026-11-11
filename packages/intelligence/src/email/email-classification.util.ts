import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { JsonObject } from '@personal-os/contracts';
import {
  admitsTransaction,
  SEMANTIC_ROUTES,
  SEMANTIC_TYPES,
  SUGGESTED_TRANSACTION_DATE_SOURCES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_KINDS,
  TRANSACTION_MOVEMENT_CLASSES,
} from '../evidence/human-verification.constants';
import type { SemanticRoute } from '../evidence/human-verification.constants';

/**
 * El modelo no debe elegir `NOT_TRANSACTION`: omitir `transaction` ya expresa
 * que el correo no trae un movimiento. El validador conserva el valor para las
 * etiquetas humanas.
 */
const MODEL_TRANSACTION_KINDS = [
  'TRANSACTION',
  'PENDING',
] as const satisfies readonly (typeof TRANSACTION_KINDS)[number][];

const transactionShape = {
  kind: z.enum(TRANSACTION_KINDS).optional(),
  amount: z.number().positive().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  transactionDate: z.iso.datetime().optional(),
  suggestedTransactionDate: z.iso.datetime().optional(),
  suggestedTransactionDateSource: z
    .enum(SUGGESTED_TRANSACTION_DATE_SOURCES)
    .optional(),
  direction: z.enum(TRANSACTION_DIRECTIONS).optional(),
  merchant: z.string().trim().min(1).max(160).optional(),
  bankReference: z.string().trim().min(1).max(120).optional(),
  last4: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  accountNumberLast4: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  movementClass: z.enum(TRANSACTION_MOVEMENT_CLASSES).optional(),
  bankStatusNormalized: z
    .enum([
      'APPROVED',
      'COMPLETED',
      'POSTED',
      'PENDING',
      'IN_PROGRESS',
      'AUTHORIZED',
      'DECLINED',
      'REJECTED',
      'FAILED',
      'CANCELLED',
      'VOIDED',
      'REVERSED',
      'REFUNDED',
      'CHARGEBACK',
      'UNKNOWN',
    ])
    .optional(),
  statusConfidence: z.number().min(0).max(1).optional(),
  statusEvidence: z.string().trim().max(240).optional(),
  reverseOfBankReference: z.string().trim().min(1).max(120).optional(),
  reverseOfEmailMessageId: z.string().trim().min(1).max(512).optional(),
  receivedAmount: z.number().positive().optional(),
  transferExchangeRate: z.number().positive().optional(),
  categoryNameHint: z.string().trim().min(1).max(80).optional(),
};

const transactionSchema = z.strictObject(transactionShape).optional();

const classificationShape = {
  relevance: z.boolean(),
  semanticType: z.enum(SEMANTIC_TYPES),
  routes: z.array(z.enum(SEMANTIC_ROUTES)).max(SEMANTIC_ROUTES.length),
  transaction: transactionSchema,
  confidence: z.number().min(0).max(1),
};

const classificationSchema = z.strictObject(classificationShape);

const modelClassificationSchema = z.strictObject({
  ...classificationShape,
  transaction: z
    .strictObject({
      ...transactionShape,
      kind: z.enum(MODEL_TRANSACTION_KINDS).optional(),
    })
    .optional(),
});

export type EmailClassification = z.infer<typeof classificationSchema>;
export type ClassificationLabels = Omit<EmailClassification, 'confidence'>;

export const EMAIL_CLASSIFICATION_JSON_SCHEMA = z.toJSONSchema(
  modelClassificationSchema,
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
  const violation = classificationRuleViolation(parsed);
  if (violation) {
    throw new Error(violation);
  }
  return parsed;
}

/** Same closed rules as `validateEmailClassification`, for callers that skip invalid labels. */
export function tryValidateEmailClassification(
  value: unknown,
): EmailClassification | null {
  const parsed = classificationSchema.safeParse(value);
  if (!parsed.success || classificationRuleViolation(parsed.data)) {
    return null;
  }
  return parsed.data;
}

/** Normaliza la salida del modelo y luego aplica las reglas cerradas. */
export function validateModelClassification(
  value: unknown,
): EmailClassification {
  return validateEmailClassification(normalizeModelClassification(value));
}

/**
 * Acerca la salida del modelo a las reglas cerradas sin añadir ni cambiar
 * datos. Solo cubre desviaciones reproducidas con el proveedor real:
 *
 * - un tipo sin transacción puede llegar con `kind: NOT_TRANSACTION`;
 * - el tipo de un código de un solo uso implica que no es financiero.
 *
 * Cualquier otra diferencia sigue siendo un fallo de validación.
 */
export function normalizeModelClassification(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const candidate = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...candidate };
  if (normalized.semanticType === 'SECURITY_OTP') {
    normalized.relevance = false;
  }
  const rejectedTransaction =
    isKindNotTransaction(normalized.transaction) &&
    !admitsTransaction(asString(normalized.semanticType));
  if (rejectedTransaction) {
    delete normalized.transaction;
  }
  return normalized;
}

function isKindNotTransaction(transaction: unknown): boolean {
  return (
    typeof transaction === 'object' &&
    transaction !== null &&
    (transaction as Record<string, unknown>).kind === 'NOT_TRANSACTION'
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function classificationRuleViolation(
  parsed: EmailClassification,
): string | null {
  if (new Set(parsed.routes).size !== parsed.routes.length) {
    return 'duplicate classification route';
  }
  if (parsed.semanticType === 'FIN_TRANSACTION' && !parsed.transaction?.kind) {
    return 'financial transaction requires a transaction kind';
  }
  if (
    (parsed.semanticType === 'PURCHASE_RECEIPT' ||
      parsed.semanticType === 'SUBSCRIPTION_BILLING') &&
    parsed.transaction?.kind
  ) {
    return 'receipt classification cannot set a transaction kind';
  }
  if (parsed.transaction && !admitsTransaction(parsed.semanticType)) {
    return 'transaction data is not valid for this semantic type';
  }
  if (parsed.semanticType === 'SECURITY_ALERT' && !parsed.relevance) {
    return 'security alert must be relevant';
  }
  if (parsed.semanticType === 'SECURITY_OTP' && parsed.relevance) {
    return 'one-time codes are not financial-relevant';
  }
  const requiredRoute = REQUIRED_ROUTES[parsed.semanticType];
  if (
    requiredRoute &&
    !parsed.routes.includes(requiredRoute as SemanticRoute)
  ) {
    return 'classification is missing its required route';
  }
  const suggestion = parsed.transaction?.suggestedTransactionDate;
  const suggestionSource = parsed.transaction?.suggestedTransactionDateSource;
  if (suggestion && !suggestionSource) {
    return 'suggested transaction date requires its source';
  }
  if (suggestionSource && !suggestion) {
    return 'transaction date source requires a suggested date';
  }
  return null;
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

/**
 * Completes a transaction label with the date the flow knows from the header.
 * The model never fills it, and transactionDate stays absent when the message
 * did not state the operation date.
 */
export function withSuggestedTransactionDate({
  classification,
  receivedAt,
}: {
  classification: EmailClassification;
  receivedAt: Date;
}): EmailClassification {
  if (!classification.transaction) {
    return classification;
  }
  return validateEmailClassification({
    ...classification,
    transaction: {
      ...classification.transaction,
      suggestedTransactionDate: receivedAt.toISOString(),
      suggestedTransactionDateSource: SUGGESTED_TRANSACTION_DATE_SOURCES[0],
    },
  });
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
  prompt: 'email-classification-prompt-v3',
  schema: 'email-classification-schema-v3',
  parser: 'known-template-parser-v1',
} as const;
