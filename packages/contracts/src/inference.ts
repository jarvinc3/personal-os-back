import type { JsonObject } from './primitives';

export const INFERENCE_COMPLETION = Symbol.for(
  'personal-os.contracts.inference-completion',
);

export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}
export interface InferenceCompletion {
  content: string;
  provider: string;
  model: string;
}
export interface StructuredInferenceRequest<T> {
  task: string;
  messages: readonly InferenceMessage[];
  jsonSchema: JsonObject;
  validate(value: unknown): T;
  promptVersion: string;
  schemaVersion: string;
  userId?: string;
  sourceType?: string;
  sourceId?: string;
  preferredProvider?: string | null;
  /**
   * La telemetría de inferencia se guarda por defecto. Una vista previa la
   * apaga para no dejar rastro de una corrida que no debe escribir nada.
   */
  recordTelemetry?: boolean;
}
export interface StructuredInference<T> {
  value: T;
  provider: string;
  model: string;
  latencyMs: number;
  fallbackCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * Costo estimado de todos los intentos acumulados, cada uno con la tarifa de
   * su modelo. Null cuando algún intento no informó tokens.
   */
  costUsd: number | null;
}
export class StructuredInferenceOutputError extends Error {
  readonly code = 'STRUCTURED_OUTPUT_INVALID';

  constructor(
    readonly provider: string | null = null,
    readonly model: string | null = null,
    readonly attempts = 0,
    /**
     * Causa acotada para diagnóstico: `INVALID_JSON` o `SCHEMA_VALIDATION:` con
     * los campos rechazados. Nunca incluye el contenido del modelo.
     */
    readonly detail: string | null = null,
    /**
     * Costo de los intentos ya cobrados de esta inferencia, para ajustar la
     * reserva aunque la salida se haya rechazado. Null si no se conoce.
     */
    readonly costUsd: number | null = null,
    /**
     * Tokens de entrada de los intentos ya cobrados, para que el ajuste del
     * tope diario no los devuelva. Null si algún intento no los informó.
     */
    readonly inputTokens: number | null = null,
    /** Tokens de salida de los intentos ya cobrados. Null si no se conocen. */
    readonly outputTokens: number | null = null,
  ) {
    super('The model output did not match the required structured schema');
    this.name = 'StructuredInferenceOutputError';
  }
}
export class StructuredInferenceProviderError extends Error {
  readonly code = 'INFERENCE_PROVIDER_FAILURE';

  constructor(
    readonly retryable: boolean,
    readonly provider: string | null = null,
    readonly model: string | null = null,
    readonly attempts = 0,
    readonly httpStatus: number | null = null,
  ) {
    super('AI inference provider unavailable');
    this.name = 'StructuredInferenceProviderError';
  }
}
// AI-0 preserved the provider pool; AI-1 adds structured, validated inference.
export interface InferenceCompletionPort {
  complete(messages: readonly InferenceMessage[]): Promise<InferenceCompletion>;
  infer<T>(
    request: StructuredInferenceRequest<T>,
  ): Promise<StructuredInference<T>>;
}
