import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type {
  InferenceMessage,
  StructuredInference,
  StructuredInferenceRequest,
} from '@personal-os/contracts';
import {
  StructuredInferenceOutputError,
  StructuredInferenceProviderError,
} from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';
import { createHmac } from 'node:crypto';
import { AI_PROVIDER } from '../../shared/ai-provider.token';
import { inferenceCostUsd } from '../inference-pricing';
import type {
  AIService as AIProviderClient,
  ChatMessage,
} from '../../shared/ai.types';
import {
  getProviderHttpStatus,
  isRetryableProviderError,
} from '../../shared/is-retryable-provider-error';
import {
  buildProviderFailureEvidenceCode,
  buildProviderFailureLogDetails,
  providerFailureLogMessage,
} from '../../shared/provider-failure';

const RETENTION_DAYS = 90;
const FINGERPRINT_VERSION = 'v1';
const MAX_REPORTED_ISSUES = 5;
const MAX_DETAIL_LENGTH = 200;
const RATE_LIMIT_STATUS = 429;
const PAYMENT_REQUIRED_STATUS = 402;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const DEFAULT_QUOTA_COOLDOWN_MS = 30 * 60_000;

/**
 * Lee el `Retry-After` de un error del proveedor, en segundos o como fecha HTTP.
 * Es la espera que pide el proveedor antes de recibir otra llamada.
 */
function retryAfterMs(error: unknown): number | null {
  const header = readRetryAfterHeader(error);
  if (header === null) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }
  const date = Date.parse(header);
  if (Number.isNaN(date)) {
    return null;
  }
  const remainingMs = date - Date.now();
  return remainingMs > 0 ? remainingMs : null;
}

function readRetryAfterHeader(error: unknown): string | null {
  const headers =
    (error as { headers?: unknown }).headers ??
    (error as { response?: { headers?: unknown } }).response?.headers;
  if (headers && typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get('retry-after');
  }
  if (headers && typeof headers === 'object') {
    const record = headers as Record<string, unknown>;
    const value = record['retry-after'] ?? record['Retry-After'];
    return typeof value === 'string' ? value : null;
  }
  return null;
}

class InvalidOutputError extends Error {
  constructor(
    readonly errorCode: 'INVALID_JSON' | 'SCHEMA_VALIDATION',
    readonly detail: string = errorCode,
  ) {
    super(detail);
  }
}

/**
 * Resume el rechazo sin copiar el contenido del modelo: rutas y códigos de las
 * comprobaciones, o el mensaje de la regla cerrada que falló.
 */
function describeValidationFailure(error: unknown): string {
  const issues = (error as { issues?: unknown }).issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const described = issues
      .slice(0, MAX_REPORTED_ISSUES)
      .map((issue) => {
        const { path, code } = issue as { path?: unknown; code?: unknown };
        const field = Array.isArray(path) ? path.join('.') : '';
        const issueCode = typeof code === 'string' ? code : 'invalid';
        return field ? `${field}:${issueCode}` : issueCode;
      })
      .join(', ');
    return described.slice(0, MAX_DETAIL_LENGTH);
  }
  if (error instanceof Error && error.message) {
    return error.message.slice(0, MAX_DETAIL_LENGTH);
  }
  return 'unknown';
}

function extractJson(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : null;
}

function toProviderMessages(
  messages: readonly InferenceMessage[],
  schema: StructuredInferenceRequest<unknown>['jsonSchema'],
): ChatMessage[] {
  const schemaInstruction = [
    'Return exactly one JSON object matching this JSON Schema.',
    'Do not include markdown fences or any text outside the object.',
    JSON.stringify(schema),
  ].join('\n');
  const systemIndex = messages.findIndex(
    (message) => message.role === 'system',
  );
  if (systemIndex < 0) {
    return [
      { role: 'system', content: schemaInstruction },
      ...messages,
    ] as ChatMessage[];
  }
  return messages.map((message, index) =>
    index === systemIndex
      ? { ...message, content: `${message.content}\n\n${schemaInstruction}` }
      : { ...message },
  );
}

function fingerprintKey(encryptionKey: string): Buffer {
  return createHmac('sha256', encryptionKey)
    .update(`personal-os:ai-inference:fingerprint:${FINGERPRINT_VERSION}`)
    .digest();
}

function fingerprint(
  key: Buffer,
  input: {
    userId?: string;
    task: string;
    messages: readonly InferenceMessage[];
    promptVersion: string;
    schemaVersion: string;
    jsonSchema: StructuredInferenceRequest<unknown>['jsonSchema'];
  },
): string {
  return createHmac('sha256', key).update(JSON.stringify(input)).digest('hex');
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

@Injectable()
export class AiInferenceGateway {
  private readonly logger = new Logger(AiInferenceGateway.name);
  private roundRobinIndex = 0;
  private readonly providerCooldownUntil = new Map<string, number>();
  private readonly telemetryKey: Buffer;

  constructor(
    @Inject(AI_PROVIDER) private readonly providers: AIProviderClient[],
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.telemetryKey = fingerprintKey(
      config.getOrThrow('DATA_ENCRYPTION_KEY', { infer: true }),
    );
  }

  async infer<T>(
    request: StructuredInferenceRequest<T>,
  ): Promise<StructuredInference<T>> {
    const startedAt = Date.now();
    const inputFingerprint = fingerprint(this.telemetryKey, {
      userId: request.userId,
      task: request.task,
      messages: request.messages,
      promptVersion: request.promptVersion,
      schemaVersion: request.schemaVersion,
      jsonSchema: request.jsonSchema,
    });
    const ordered = this.orderedProviders(request.preferredProvider);
    const capableProviderCount = ordered.filter((provider) =>
      Boolean(provider.chatComplete),
    ).length;
    const messages = toProviderMessages(request.messages, request.jsonSchema);
    let attempts = 0;
    let billedInputTokens: number | null = null;
    let billedOutputTokens: number | null = null;
    let billedCostUsd = 0;
    let billedUsageKnown = true;
    let lastProvider: AIProviderClient | undefined;
    let lastHttpStatus: number | null = null;
    let lastErrorCode = 'NO_PROVIDER';
    let lastOutputDetail: string | null = null;

    try {
      for (const provider of ordered) {
        if (!provider.chatComplete) {
          continue;
        }
        attempts += 1;
        lastProvider = provider;
        try {
          const completion = await provider.chatComplete(messages);
          const usage = completion.usage;
          if (usage?.inputTokens != null && usage.outputTokens != null) {
            billedInputTokens = (billedInputTokens ?? 0) + usage.inputTokens;
            billedOutputTokens = (billedOutputTokens ?? 0) + usage.outputTokens;
            billedCostUsd += inferenceCostUsd({
              model: provider.model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
            });
          } else {
            billedUsageKnown = false;
          }
          const json = extractJson(completion.content);
          if (!json) {
            throw new InvalidOutputError('INVALID_JSON');
          }
          let decoded: unknown;
          try {
            decoded = JSON.parse(json);
          } catch {
            throw new InvalidOutputError('INVALID_JSON');
          }
          let value: T;
          try {
            value = request.validate(decoded);
          } catch (error) {
            throw new InvalidOutputError(
              'SCHEMA_VALIDATION',
              `SCHEMA_VALIDATION:${describeValidationFailure(error)}`,
            );
          }

          this.providerCooldownUntil.delete(provider.name);
          const latencyMs = Date.now() - startedAt;
          await this.persistTelemetry(request, {
            inputFingerprint,
            status: 'SUCCEEDED',
            provider: provider.name,
            model: provider.model,
            latencyMs,
            fallbackCount: Math.max(0, attempts - 1),
            inputTokens: billedInputTokens ?? undefined,
            outputTokens: billedOutputTokens ?? undefined,
            costUsd: billedUsageKnown
              ? Number(billedCostUsd.toFixed(6))
              : undefined,
          });
          return {
            value,
            provider: provider.name,
            model: provider.model,
            latencyMs,
            fallbackCount: Math.max(0, attempts - 1),
            inputTokens: billedInputTokens,
            outputTokens: billedOutputTokens,
            costUsd: billedUsageKnown ? Number(billedCostUsd.toFixed(6)) : null,
          };
        } catch (error) {
          if (error instanceof InvalidOutputError) {
            lastErrorCode = error.errorCode;
            lastOutputDetail = error.detail;
            continue;
          }
          billedUsageKnown = false;
          const retryable = isRetryableProviderError(error);
          const httpStatus = getProviderHttpStatus(error);
          const fallback = retryable && attempts < capableProviderCount;
          const failure = buildProviderFailureLogDetails({
            error,
            provider: provider.name,
            model: provider.model,
            retryable,
            fallback,
          });
          this.logger.warn(providerFailureLogMessage(failure));
          lastErrorCode = buildProviderFailureEvidenceCode(failure);
          lastOutputDetail = null;
          lastHttpStatus = httpStatus;
          this.startCooldown(provider, error);
          if (!retryable) {
            throw new StructuredInferenceProviderError(
              false,
              provider.name,
              provider.model,
              attempts,
              lastHttpStatus,
            );
          }
        }
      }

      if (ordered.length === 0) {
        lastErrorCode =
          this.providers.length > 0 ? 'PROVIDER_COOLDOWN' : 'NO_PROVIDER';
        throw new StructuredInferenceProviderError(false, null, null, 0, null);
      }

      if (
        lastErrorCode === 'INVALID_JSON' ||
        lastErrorCode === 'SCHEMA_VALIDATION'
      ) {
        throw new StructuredInferenceOutputError(
          lastProvider?.name ?? null,
          lastProvider?.model ?? null,
          attempts,
          lastOutputDetail,
          billedUsageKnown ? Number(billedCostUsd.toFixed(6)) : null,
        );
      }
      throw new StructuredInferenceProviderError(
        attempts > 0,
        lastProvider?.name ?? null,
        lastProvider?.model ?? null,
        attempts,
        lastHttpStatus,
      );
    } catch (error) {
      await this.persistTelemetry(request, {
        inputFingerprint,
        status: 'FAILED',
        provider: lastProvider?.name ?? 'none',
        model: lastProvider?.model ?? 'none',
        latencyMs: Date.now() - startedAt,
        fallbackCount: Math.max(0, attempts - 1),
        errorCode: lastOutputDetail ?? lastErrorCode,
        inputTokens: billedInputTokens ?? undefined,
        outputTokens: billedOutputTokens ?? undefined,
        costUsd: billedUsageKnown
          ? Number(billedCostUsd.toFixed(6))
          : undefined,
      });
      throw error;
    }
  }

  private orderedProviders(
    preferredProvider?: string | null,
  ): AIProviderClient[] {
    const available = this.providers.filter(
      (provider) => !this.isCoolingDown(provider),
    );
    const count = available.length;
    if (count === 0) {
      return [];
    }
    const start = this.roundRobinIndex % count;
    this.roundRobinIndex = (start + 1) % count;
    const rotated = Array.from(
      { length: count },
      (_, index) => available[(start + index) % count],
    );
    if (!preferredProvider) {
      return rotated;
    }
    const preferred = rotated.find(
      (provider) =>
        provider.name.toLowerCase() === preferredProvider.trim().toLowerCase(),
    );
    return preferred
      ? [preferred, ...rotated.filter((provider) => provider !== preferred)]
      : rotated;
  }

  private isCoolingDown(provider: AIProviderClient): boolean {
    const until = this.providerCooldownUntil.get(provider.name) ?? 0;
    return until > Date.now();
  }

  /**
   * Un proveedor con límite o sin cupo deja de recibir llamadas hasta el
   * momento que indica, para no repetir el mismo rechazo en cada inferencia.
   * 402 es cupo y tarda en recuperarse; 429 es una ventana de ritmo.
   */
  private startCooldown(provider: AIProviderClient, error: unknown): void {
    const status = getProviderHttpStatus(error);
    const fallbackMs =
      status === RATE_LIMIT_STATUS
        ? DEFAULT_RATE_LIMIT_COOLDOWN_MS
        : status === PAYMENT_REQUIRED_STATUS
          ? DEFAULT_QUOTA_COOLDOWN_MS
          : null;
    if (fallbackMs === null) {
      return;
    }
    const cooldownMs = retryAfterMs(error) ?? fallbackMs;
    this.providerCooldownUntil.set(provider.name, Date.now() + cooldownMs);
  }

  private async persistTelemetry<T>(
    request: StructuredInferenceRequest<T>,
    record: {
      inputFingerprint: string;
      status: 'SUCCEEDED' | 'FAILED';
      provider: string;
      model: string;
      latencyMs: number;
      fallbackCount: number;
      errorCode?: string;
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
    },
  ): Promise<void> {
    if (!request.userId || request.recordTelemetry === false) {
      return;
    }
    try {
      const createdAt = new Date();
      await this.prisma.aiInference.create({
        data: {
          userId: request.userId,
          task: request.task,
          sourceType: request.sourceType,
          sourceId: request.sourceId,
          provider: record.provider,
          model: record.model,
          promptVersion: request.promptVersion,
          schemaVersion: request.schemaVersion,
          inputFingerprint: record.inputFingerprint,
          fingerprintVersion: FINGERPRINT_VERSION,
          status: record.status,
          errorCode: record.errorCode,
          fallbackCount: record.fallbackCount,
          latencyMs: record.latencyMs,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          costUsd: record.costUsd,
          createdAt,
          expiresAt: addDays(createdAt, RETENTION_DAYS),
        },
      });
    } catch {
      this.logger.warn('AI inference telemetry write failed');
    }
  }
}
