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
import type {
  AIService as AIProviderClient,
  ChatMessage,
} from '../../shared/ai.types';
import {
  getProviderHttpStatus,
  isRetryableProviderError,
} from '../../shared/is-retryable-provider-error';

const RETENTION_DAYS = 90;
const FINGERPRINT_VERSION = 'v1';

class InvalidOutputError extends Error {}

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
    const messages = toProviderMessages(request.messages, request.jsonSchema);
    let attempts = 0;
    let lastProvider: AIProviderClient | undefined;
    let lastHttpStatus: number | null = null;
    let lastErrorCode = 'NO_PROVIDER';

    try {
      for (const provider of ordered) {
        if (!provider.chatComplete) {
          continue;
        }
        attempts += 1;
        lastProvider = provider;
        try {
          const completion = await provider.chatComplete(messages);
          const json = extractJson(completion.content);
          if (!json) {
            lastErrorCode = 'INVALID_JSON';
            throw new InvalidOutputError(lastErrorCode);
          }
          let decoded: unknown;
          try {
            decoded = JSON.parse(json);
          } catch {
            lastErrorCode = 'INVALID_JSON';
            throw new InvalidOutputError(lastErrorCode);
          }
          let value: T;
          try {
            value = request.validate(decoded);
          } catch {
            lastErrorCode = 'SCHEMA_VALIDATION';
            throw new InvalidOutputError(lastErrorCode);
          }

          const latencyMs = Date.now() - startedAt;
          await this.persistTelemetry(request, {
            inputFingerprint,
            status: 'SUCCEEDED',
            provider: provider.name,
            model: provider.model,
            latencyMs,
            fallbackCount: Math.max(0, attempts - 1),
            inputTokens: completion.usage?.inputTokens,
            outputTokens: completion.usage?.outputTokens,
          });
          return {
            value,
            provider: provider.name,
            model: provider.model,
            latencyMs,
            fallbackCount: Math.max(0, attempts - 1),
            inputTokens: completion.usage?.inputTokens ?? null,
            outputTokens: completion.usage?.outputTokens ?? null,
          };
        } catch (error) {
          if (error instanceof InvalidOutputError) {
            continue;
          }
          lastErrorCode = 'PROVIDER_FAILURE';
          lastHttpStatus = getProviderHttpStatus(error);
          if (!isRetryableProviderError(error)) {
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

      if (
        ordered.length > 0 &&
        (lastErrorCode === 'INVALID_JSON' ||
          lastErrorCode === 'SCHEMA_VALIDATION')
      ) {
        throw new StructuredInferenceOutputError(
          lastProvider?.name ?? null,
          lastProvider?.model ?? null,
          attempts,
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
        errorCode: lastErrorCode,
      });
      throw error;
    }
  }

  private orderedProviders(
    preferredProvider?: string | null,
  ): AIProviderClient[] {
    const count = this.providers.length;
    if (count === 0) {
      return [];
    }
    const start = this.roundRobinIndex;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % count;
    const rotated = Array.from(
      { length: count },
      (_, index) => this.providers[(start + index) % count],
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
          createdAt,
          expiresAt: addDays(createdAt, RETENTION_DAYS),
        },
      });
    } catch {
      this.logger.warn('AI inference telemetry write failed');
    }
  }
}
