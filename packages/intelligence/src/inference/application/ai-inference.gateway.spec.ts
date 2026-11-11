import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type { PrismaService } from '@personal-os/database';
import {
  StructuredInferenceProviderError,
  type StructuredInferenceRequest,
} from '@personal-os/contracts';
import { AiInferenceGateway } from './ai-inference.gateway';
import type { AIService } from '../../shared/ai.types';

const request = (): StructuredInferenceRequest<{ value: string }> => ({
  task: 'test.structured',
  messages: [{ role: 'user', content: 'private test text' }],
  jsonSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  },
  validate(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof (value as { value?: unknown }).value !== 'string'
    ) {
      throw new Error('invalid test output');
    }
    return { value: (value as { value: string }).value };
  },
  promptVersion: 'prompt-v1',
  schemaVersion: 'schema-v1',
  userId: 'user-1',
  sourceType: 'test',
  sourceId: 'source-1',
});

function build(
  providers: AIService[],
  create = jest.fn().mockResolvedValue({}),
) {
  const prisma = { aiInference: { create } } as unknown as PrismaService;
  const config = {
    getOrThrow: () => 'test-data-encryption-key-long-enough',
  } as unknown as ConfigService<Env, true>;
  return { gateway: new AiInferenceGateway(providers, prisma, config), create };
}

describe('AiInferenceGateway', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it('validates structured output, fails over and writes metadata only', async () => {
    const invalid = {
      name: 'primary',
      model: 'model-one',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: '{"value":4}',
        toolCalls: [],
      }),
    };
    const valid = {
      name: 'fallback',
      model: 'model-two',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: '```json\n{"value":"ok"}\n```',
        toolCalls: [],
        usage: { inputTokens: 12, outputTokens: 3 },
      }),
    };
    const { gateway, create } = build([invalid, valid]);

    await expect(gateway.infer(request())).resolves.toMatchObject({
      value: { value: 'ok' },
      provider: 'fallback',
      model: 'model-two',
      fallbackCount: 1,
      inputTokens: 12,
      outputTokens: 3,
    });
    expect(valid.chatComplete).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('JSON Schema'),
        }),
      ]),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        task: 'test.structured',
        userId: 'user-1',
        status: 'SUCCEEDED',
        provider: 'fallback',
        fallbackCount: 1,
        inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        fingerprintVersion: 'v1',
        inputTokens: 12,
        outputTokens: 3,
        expiresAt: expect.any(Date),
      }),
    });
    const persisted = JSON.stringify(create.mock.calls[0][0]);
    expect(persisted).not.toContain('private test text');
    expect(persisted).not.toContain('"value":"ok"');
    const record = create.mock.calls[0][0].data as {
      createdAt: Date;
      expiresAt: Date;
    };
    expect(record.expiresAt.getTime() - record.createdAt.getTime()).toBe(
      90 * 24 * 60 * 60 * 1_000,
    );
  });

  it('honors a preferred provider ahead of the round-robin first slot', async () => {
    const first = {
      name: 'first',
      model: 'one',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: '{"value":"first"}',
        toolCalls: [],
      }),
    };
    const preferred = {
      name: 'preferred',
      model: 'two',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: '{"value":"preferred"}',
        toolCalls: [],
      }),
    };
    const { gateway } = build([first, preferred]);

    await expect(
      gateway.infer({ ...request(), preferredProvider: 'PREFERRED' }),
    ).resolves.toMatchObject({
      value: { value: 'preferred' },
      provider: 'preferred',
      fallbackCount: 0,
    });
    expect(preferred.chatComplete).toHaveBeenCalledTimes(1);
    expect(first.chatComplete).not.toHaveBeenCalled();
  });

  it('rotates the first provider across requests on the same gateway', async () => {
    const first = {
      name: 'first',
      model: 'one',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: '{"value":"first"}',
        toolCalls: [],
      }),
    };
    const second = {
      name: 'second',
      model: 'two',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: '{"value":"second"}',
        toolCalls: [],
      }),
    };
    const { gateway } = build([first, second]);

    await expect(gateway.infer(request())).resolves.toMatchObject({
      provider: 'first',
      fallbackCount: 0,
    });
    await expect(gateway.infer(request())).resolves.toMatchObject({
      provider: 'second',
      fallbackCount: 0,
    });
    expect(first.chatComplete).toHaveBeenCalledTimes(1);
    expect(second.chatComplete).toHaveBeenCalledTimes(1);
  });

  it('does not fail an inference when the telemetry write fails', async () => {
    const provider = {
      name: 'provider',
      model: 'model',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: '{"value":"ok"}',
        toolCalls: [],
      }),
    };
    const { gateway } = build(
      [provider],
      jest.fn().mockRejectedValue(new Error('database unavailable')),
    );

    await expect(gateway.infer(request())).resolves.toMatchObject({
      value: { value: 'ok' },
    });
  });

  it('sanitizes non-retryable provider errors before returning or persisting', async () => {
    const provider = {
      name: 'provider',
      model: 'model',
      chat: jest.fn(),
      chatComplete: jest.fn().mockRejectedValue(
        Object.assign(new Error('private test text in request body'), {
          statusCode: 401,
        }),
      ),
    };
    const { gateway, create } = build([provider]);

    await expect(gateway.infer(request())).rejects.toMatchObject({
      message: 'AI inference provider unavailable',
      retryable: false,
      provider: 'provider',
      model: 'model',
      attempts: 1,
      httpStatus: 401,
    } satisfies Partial<StructuredInferenceProviderError>);
    const persisted = JSON.stringify(create.mock.calls[0][0]);
    expect(persisted).not.toContain('private test text');
    expect(persisted).toContain('PROVIDER_FAILURE');
  });

  it('reads SDK statusCode and fails over on a retryable HTTP response', async () => {
    const rateLimited = {
      name: 'OpenRouter',
      model: 'model-one',
      chat: jest.fn(),
      chatComplete: jest.fn().mockRejectedValue(
        Object.assign(new Error('private provider response'), {
          statusCode: 429,
        }),
      ),
    };
    const fallback = {
      name: 'fallback',
      model: 'model-two',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: '{"value":"ok"}',
        toolCalls: [],
      }),
    };
    const { gateway } = build([rateLimited, fallback]);

    await expect(gateway.infer(request())).resolves.toMatchObject({
      value: { value: 'ok' },
      provider: 'fallback',
      fallbackCount: 1,
    });
    expect(rateLimited.chatComplete).toHaveBeenCalledTimes(1);
    expect(fallback.chatComplete).toHaveBeenCalledTimes(1);
  });

  it('does not write telemetry when the caller asks to skip it', async () => {
    const provider = {
      name: 'primary',
      model: 'model-one',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: '{"value":"ok"}',
        toolCalls: [],
      }),
    };
    const { gateway, create } = build([provider]);

    await expect(
      gateway.infer({ ...request(), recordTelemetry: false }),
    ).resolves.toMatchObject({ value: { value: 'ok' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('names the rejected fields when the validator reports issues', async () => {
    const provider = {
      name: 'provider',
      model: 'model',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: '{"value":4}',
        toolCalls: [],
      }),
    };
    const { gateway, create } = build([provider]);
    const zodFailure = Object.assign(new Error('invalid output'), {
      issues: [{ path: ['transaction', 'currency'], code: 'invalid_format' }],
    });

    await expect(
      gateway.infer({
        ...request(),
        validate() {
          throw zodFailure;
        },
      }),
    ).rejects.toMatchObject({
      code: 'STRUCTURED_OUTPUT_INVALID',
      detail: 'SCHEMA_VALIDATION:transaction.currency:invalid_format',
    });
    const record = create.mock.calls[0][0].data as { errorCode?: string };
    expect(record.errorCode).toBe(
      'SCHEMA_VALIDATION:transaction.currency:invalid_format',
    );
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain(
      'private test text',
    );
  });

  it('records a parse failure apart from a schema failure', async () => {
    const provider = {
      name: 'provider',
      model: 'model',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: 'Sin objeto JSON en la respuesta',
        toolCalls: [],
      }),
    };
    const { gateway, create } = build([provider]);

    await expect(gateway.infer(request())).rejects.toMatchObject({
      code: 'STRUCTURED_OUTPUT_INVALID',
      detail: 'INVALID_JSON',
    });
    const record = create.mock.calls[0][0].data as { errorCode?: string };
    expect(record.errorCode).toBe('INVALID_JSON');
  });

  it('reports a provider failure when an earlier invalid output left a detail', async () => {
    const invalidOutput = {
      name: 'invalid',
      model: 'model-one',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: '{"value":4}',
        toolCalls: [],
      }),
    };
    const providerFailure = {
      name: 'unavailable',
      model: 'model-two',
      chat: jest.fn(),
      chatComplete: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('forbidden'), { statusCode: 403 }),
        ),
    };
    const { gateway, create } = build([invalidOutput, providerFailure]);

    await expect(gateway.infer(request())).rejects.toMatchObject({
      code: 'INFERENCE_PROVIDER_FAILURE',
      httpStatus: 403,
    });
    const record = create.mock.calls[0][0].data as { errorCode?: string };
    expect(record.errorCode).toBe('PROVIDER_FAILURE');
  });

  it('pauses a rate-limited provider and keeps serving with the next one', async () => {
    const now = Date.parse('2026-11-11T20:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const limited = {
      name: 'Groq',
      model: 'model-one',
      chat: jest.fn(),
      chatComplete: jest.fn().mockRejectedValue(
        Object.assign(new Error('rate limit'), {
          statusCode: 429,
          headers: new Headers({ 'retry-after': '120' }),
        }),
      ),
    };
    const healthy = {
      name: 'OpenRouter',
      model: 'model-two',
      chat: jest.fn(),
      chatComplete: jest.fn().mockResolvedValue({
        content: '{"value":"ok"}',
        toolCalls: [],
      }),
    };
    const { gateway, create } = build([limited, healthy]);

    await expect(gateway.infer(request())).resolves.toMatchObject({
      provider: 'OpenRouter',
    });
    await expect(gateway.infer(request())).resolves.toMatchObject({
      provider: 'OpenRouter',
    });

    expect(limited.chatComplete).toHaveBeenCalledTimes(1);
    expect(healthy.chatComplete).toHaveBeenCalledTimes(2);
    const secondTelemetry = create.mock.calls[1][0].data as {
      provider: string;
    };
    expect(secondTelemetry.provider).toBe('OpenRouter');
  });

  it('parks a provider without quota and retries it after the default cooldown', async () => {
    let now = Date.parse('2026-11-11T20:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const noQuota = {
      name: 'OpenRouter',
      model: 'model-two',
      chat: jest.fn(),
      chatComplete: jest
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error('requires more credits'), {
            statusCode: 402,
          }),
        )
        .mockResolvedValue({ content: '{"value":"ok"}', toolCalls: [] }),
    };
    const { gateway, create } = build([noQuota]);

    await expect(gateway.infer(request())).rejects.toMatchObject({
      code: 'INFERENCE_PROVIDER_FAILURE',
    });
    await expect(gateway.infer(request())).rejects.toMatchObject({
      code: 'INFERENCE_PROVIDER_FAILURE',
    });
    expect(noQuota.chatComplete).toHaveBeenCalledTimes(1);
    const coolingTelemetry = create.mock.calls[1][0].data as {
      errorCode?: string;
    };
    expect(coolingTelemetry.errorCode).toBe('PROVIDER_COOLDOWN');

    now += 30 * 60_000;
    await expect(gateway.infer(request())).resolves.toMatchObject({
      provider: 'OpenRouter',
    });
    expect(noQuota.chatComplete).toHaveBeenCalledTimes(2);
  });

  it('honors a Retry-After date before calling the paused provider again', async () => {
    let now = Date.parse('2026-11-11T20:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const limited = {
      name: 'Groq',
      model: 'model-one',
      chat: jest.fn(),
      chatComplete: jest
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error('too many requests'), {
            status: 429,
            response: {
              headers: { 'Retry-After': new Date(now + 90_000).toUTCString() },
            },
          }),
        )
        .mockResolvedValue({ content: '{"value":"ok"}', toolCalls: [] }),
    };
    const { gateway } = build([limited]);

    await expect(gateway.infer(request())).rejects.toMatchObject({
      code: 'INFERENCE_PROVIDER_FAILURE',
    });
    await expect(gateway.infer(request())).rejects.toMatchObject({
      code: 'INFERENCE_PROVIDER_FAILURE',
    });
    expect(limited.chatComplete).toHaveBeenCalledTimes(1);

    now += 91_000;
    await expect(gateway.infer(request())).resolves.toMatchObject({
      provider: 'Groq',
    });
  });
});
