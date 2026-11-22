import type { Logger } from '@nestjs/common';
import {
  StructuredInferenceOutputError,
  type InferenceCompletionPort,
  type InferenceMessage,
  type StructuredInference,
  type StructuredInferenceRequest,
} from '@personal-os/contracts';
import {
  CLASSIFICATION_PREFERRED_PROVIDER,
  CLASSIFICATION_SYSTEM_PROMPT,
  CLASSIFICATION_TASK,
  MODEL_REPAIR_INSTRUCTION,
} from './ai-email-classification.prompt';
import type { ClassifiableMessage } from './ai-email-classification.types';
import type { EmailClassificationLimits } from './email-classification-limits';
import {
  EMAIL_CLASSIFICATION_JSON_SCHEMA,
  EMAIL_CLASSIFICATION_VERSIONS,
  validateModelClassification,
  type EmailClassification,
} from './email-classification.util';

/** La clasificación del modelo y el rastro de la reparación, si la hubo. */
export type EmailClassificationInference = {
  inferred: StructuredInference<EmailClassification>;
  repaired: boolean;
  rejectedCostUsd: number | null;
  rejectedTokens: number | null;
};

type ClassifyEmailWithModelInput = {
  inference: InferenceCompletionPort;
  limits: Pick<EmailClassificationLimits, 'maxSenderChars' | 'maxSubjectChars'>;
  logger: Logger;
  userId: string;
  message: ClassifiableMessage;
  content: string;
  recordTelemetry?: boolean;
  onModelCall?: () => void;
};

/**
 * Clasifica con el modelo y admite un único reintento de reparación cuando la
 * respuesta no cumple el contrato. Si el reintento también falla, el error
 * sube y el correo queda sin clasificar.
 */
export async function classifyEmailWithModel({
  inference,
  limits,
  logger,
  userId,
  message,
  content,
  recordTelemetry,
  onModelCall,
}: ClassifyEmailWithModelInput): Promise<EmailClassificationInference> {
  const messages: InferenceMessage[] = [
    { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        from: message.fromAddress.slice(0, limits.maxSenderChars),
        subject: message.subject.slice(0, limits.maxSubjectChars),
        emailContent: content,
      }),
    },
  ];
  const request: StructuredInferenceRequest<EmailClassification> = {
    userId,
    task: CLASSIFICATION_TASK,
    sourceType: 'EMAIL_MESSAGE',
    sourceId: message.id,
    promptVersion: EMAIL_CLASSIFICATION_VERSIONS.prompt,
    schemaVersion: EMAIL_CLASSIFICATION_VERSIONS.schema,
    jsonSchema: EMAIL_CLASSIFICATION_JSON_SCHEMA,
    validate: validateModelClassification,
    recordTelemetry,
    preferredProvider: CLASSIFICATION_PREFERRED_PROVIDER,
    messages,
  };

  onModelCall?.();
  try {
    const inferred = await inference.infer(request);
    return {
      inferred,
      repaired: false,
      rejectedCostUsd: null,
      rejectedTokens: null,
    };
  } catch (error) {
    if (!(error instanceof StructuredInferenceOutputError)) {
      throw error;
    }
    const rejection = error.detail ?? 'the output did not match the schema';
    logger.warn(
      `Email classification output rejected for message ${message.id}: ${rejection}`,
    );
    onModelCall?.();
    const inferred = await inference.infer({
      ...request,
      messages: [
        ...messages,
        {
          role: 'user',
          content: `${MODEL_REPAIR_INSTRUCTION}\nRejection: ${rejection}`,
        },
      ],
    });
    return {
      inferred,
      repaired: true,
      rejectedCostUsd: error.costUsd,
      rejectedTokens: sumKnownTokens(error.inputTokens, error.outputTokens),
    };
  }
}

/** Suma dos costos conocidos; null si falta alguno. */
export function sumKnownCosts(
  first: number | null,
  second: number | null,
): number | null {
  if (first == null || second == null) {
    return null;
  }
  return Number((first + second).toFixed(6));
}

/** Suma los tokens conocidos de dos intentos; null si falta alguno. */
export function sumKnownTokens(
  first: number | null,
  second: number | null,
): number | null {
  if (first == null || second == null) {
    return null;
  }
  return first + second;
}

/** Tokens facturados de todos los intentos; null si el proveedor no los reporta. */
export function inferenceTokens(
  inference: StructuredInference<unknown>,
): number | null {
  if (inference.inputTokens == null || inference.outputTokens == null) {
    return null;
  }
  return inference.inputTokens + inference.outputTokens;
}
