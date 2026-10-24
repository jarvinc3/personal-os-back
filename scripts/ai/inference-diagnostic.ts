import type { JsonObject } from '@personal-os/contracts';
import type { Env } from '@personal-os/config';
import { AiInferenceGateway } from '@personal-os/ai-agent';
import type { ConfigService } from '@nestjs/config';
import { createGroqProvider } from '../../packages/ai-agent/src/providers/groq.provider';
import { createOpenCodeProvider } from '../../packages/ai-agent/src/providers/opencode.provider';
import { createOpenRouterProvider } from '../../packages/ai-agent/src/providers/openrouter.provider';
import type { AIService } from '../../packages/ai-agent/src/shared/ai.types';
import type { PrismaService } from '@personal-os/database';

function providerKey(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && !value.startsWith('YOUR_') ? value : undefined;
}

function configuredProvider(
  name: string,
  create: (apiKey: string) => AIService,
): AIService | undefined {
  const key = providerKey(name);
  return key ? create(key) : undefined;
}

async function main(): Promise<void> {
  const providers = [
    configuredProvider('GROQ_API_KEY', createGroqProvider),
    configuredProvider('OPENCODE_API_KEY', createOpenCodeProvider),
    configuredProvider('OPENROUTER_API_KEY', createOpenRouterProvider),
  ].filter((provider) => provider !== undefined);

  if (providers.length === 0) {
    throw new Error('Configure at least one AI provider key in .env');
  }

  const noPersistence = {
    aiInference: { create: async () => undefined },
  } as unknown as PrismaService;
  const config = {
    getOrThrow: () =>
      process.env.DATA_ENCRYPTION_KEY ?? 'local-diagnostic-key-not-persisted',
  } as unknown as ConfigService<Env, true>;
  const gateway = new AiInferenceGateway(providers, noPersistence, config);

  try {
    const result = await gateway.infer({
      task: 'diagnostic.structured-output',
      messages: [
        {
          role: 'system',
          content: 'You are a diagnostic provider check.',
        },
        {
          role: 'user',
          content: 'Return a short greeting for the local diagnostic harness.',
        },
      ],
      jsonSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
        additionalProperties: false,
      } as JsonObject,
      validate(value: unknown) {
        if (
          typeof value !== 'object' ||
          value === null ||
          typeof (value as { message?: unknown }).message !== 'string'
        ) {
          throw new Error('Expected a string message');
        }
        return { message: (value as { message: string }).message };
      },
      promptVersion: 'diagnostic-v1',
      schemaVersion: 'diagnostic-v1',
    });

    console.log(
      JSON.stringify(
        {
          task: 'diagnostic.structured-output',
          provider: result.provider,
          model: result.model,
          result: result.value,
          latencyMs: result.latencyMs,
          fallbackCount: result.fallbackCount,
          error: null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          task: 'diagnostic.structured-output',
          provider: null,
          model: null,
          result: null,
          latencyMs: null,
          fallbackCount: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

void main();
