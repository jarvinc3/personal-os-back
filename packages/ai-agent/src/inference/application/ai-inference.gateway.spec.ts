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
});
