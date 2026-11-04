import type { JsonObject } from '@personal-os/contracts';
import {
  StructuredInferenceOutputError,
  StructuredInferenceProviderError,
} from '@personal-os/contracts';
import type { Env } from '@personal-os/config';
import {
  AiInferenceGateway,
  createAiProviderPool,
} from '@personal-os/intelligence';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '@personal-os/database';

function providerKey(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && !value.startsWith('YOUR_') ? value : undefined;
}

type ProviderId = 'groq' | 'openrouter';

function selectedProvider(args: string[] = process.argv.slice(2)):
  | ProviderId
  | undefined {
  const options = args[0] === '--' ? args.slice(1) : args;
  if (options.length === 0) {
    return undefined;
  }
  const provider = options[1]?.toLowerCase();
  if (
    options.length !== 2 ||
    options[0] !== '--provider' ||
    !['groq', 'openrouter'].includes(provider ?? '')
  ) {
    throw new Error(
      'Usage: pnpm run ai:diagnostic -- --provider groq|openrouter',
    );
  }
  return provider as ProviderId;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const requestedProvider = selectedProvider();
  const providers = createAiProviderPool({
    groqApiKey:
      requestedProvider === 'openrouter'
        ? undefined
        : providerKey('GROQ_API_KEY'),
    openRouterApiKey:
      requestedProvider === 'groq'
        ? undefined
        : providerKey('OPENROUTER_API_KEY'),
  });

  if (providers.length === 0) {
    if (requestedProvider) {
      throw new Error(`Configure ${requestedProvider} provider key in .env`);
    }
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
          attempts: result.fallbackCount + 1,
          error: null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const inferenceError =
      error instanceof StructuredInferenceProviderError ||
      error instanceof StructuredInferenceOutputError
        ? error
        : undefined;
    console.error(
      JSON.stringify(
        {
          task: 'diagnostic.structured-output',
          provider: inferenceError?.provider ?? null,
          model: inferenceError?.model ?? null,
          result: null,
          latencyMs: Date.now() - startedAt,
          fallbackCount:
            inferenceError && inferenceError.attempts > 0
              ? inferenceError.attempts - 1
              : null,
          attempts: inferenceError?.attempts ?? 0,
          httpStatus:
            error instanceof StructuredInferenceProviderError
              ? error.httpStatus
              : null,
          errorCode: inferenceError?.code ?? 'DIAGNOSTIC_FAILED',
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
