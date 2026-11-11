/* eslint-disable @typescript-eslint/prefer-promise-reject-errors -- providers may reject with non-Error values and the pool must survive them */
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { AiService } from './ai.service';
import type {
  AIService as AIProviderClient,
  ChatCompletionResult,
  ChatMessage,
} from '../../shared/ai.types';

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'Hola' }];

const NON_RETRYABLE_STATUS = 400;
const RETRYABLE_STATUS = 429;

function createProvider(
  name: string,
  extras: Partial<AIProviderClient> = {},
): AIProviderClient {
  return {
    name,
    model: `${name}-model`,
    ...extras,
  };
}

function providerError(status: number): Error & { status: number } {
  return Object.assign(new Error(`provider failed with status ${status}`), {
    status,
  });
}

function completion(content = 'ok'): ChatCompletionResult {
  return { content, toolCalls: [] };
}

describe('AiService', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
      return;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('onModuleInit', () => {
    it('skips the failure in test mode when no provider is configured', () => {
      process.env.NODE_ENV = 'test';

      expect(() => new AiService([]).onModuleInit()).not.toThrow();
    });

    it('fails fast outside test mode when no provider is configured', () => {
      process.env.NODE_ENV = 'production';

      expect(() => new AiService([]).onModuleInit()).toThrow(
        /No AI providers configured/,
      );
    });

    it('accepts a configured pool', () => {
      const service = new AiService([createProvider('groq')]);

      expect(() => service.onModuleInit()).not.toThrow();
    });
  });

  describe('chatComplete', () => {
    it('rejects when there is no provider available', async () => {
      const service = new AiService([]);

      await expect(service.chatComplete(MESSAGES)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('skips providers without chatComplete support', async () => {
      const service = new AiService([
        createProvider('groq'),
        createProvider('fallback', {
          chatComplete: () => Promise.resolve(completion('hecho')),
        }),
      ]);

      await expect(service.chatComplete(MESSAGES)).resolves.toEqual({
        content: 'hecho',
        toolCalls: [],
        provider: 'fallback',
        model: 'fallback-model',
      });
    });

    it('rotates providers between calls', async () => {
      const service = new AiService([
        createProvider('groq', {
          chatComplete: () => Promise.resolve(completion('groq')),
        }),
        createProvider('fallback', {
          chatComplete: () => Promise.resolve(completion('fallback')),
        }),
      ]);

      await expect(service.chatComplete(MESSAGES)).resolves.toMatchObject({
        provider: 'groq',
      });
      await expect(service.chatComplete(MESSAGES)).resolves.toMatchObject({
        provider: 'fallback',
      });
      await expect(service.chatComplete(MESSAGES)).resolves.toMatchObject({
        provider: 'groq',
      });
    });

    it('moves the preferred provider to the front', async () => {
      const service = new AiService([
        createProvider('groq', {
          chatComplete: () => Promise.resolve(completion('groq')),
        }),
        createProvider('fallback', {
          chatComplete: () => Promise.resolve(completion('fallback')),
        }),
      ]);

      await expect(
        service.chatComplete(MESSAGES, 'Fallback'),
      ).resolves.toMatchObject({ provider: 'fallback' });
    });

    it('retries the next capable provider after a retryable failure', async () => {
      const service = new AiService([
        createProvider('groq', {
          chatComplete: () => Promise.reject(providerError(RETRYABLE_STATUS)),
        }),
        createProvider('fallback', {
          chatComplete: () => Promise.resolve(completion('segundo')),
        }),
      ]);

      await expect(service.chatComplete(MESSAGES)).resolves.toMatchObject({
        provider: 'fallback',
        content: 'segundo',
      });
    });

    it('rethrows a non-retryable failure', async () => {
      const failure = providerError(NON_RETRYABLE_STATUS);
      const service = new AiService([
        createProvider('groq', {
          chatComplete: () => Promise.reject(failure),
        }),
      ]);

      await expect(service.chatComplete(MESSAGES)).rejects.toBe(failure);
    });

    it('reports an unknown error when no provider can complete', async () => {
      const service = new AiService([createProvider('groq')]);

      await expect(service.chatComplete(MESSAGES)).rejects.toThrow(
        'Todos los proveedores de IA fallaron. Último error: Unknown error',
      );
    });

    it('retries when a provider rejects with a retryable plain object', async () => {
      const service = new AiService([
        createProvider('groq', {
          chatComplete: () => Promise.reject({ status: 503 }),
        }),
        createProvider('fallback', {
          chatComplete: () => Promise.resolve(completion('segundo')),
        }),
      ]);

      await expect(service.chatComplete(MESSAGES)).resolves.toMatchObject({
        provider: 'fallback',
      });
    });

    it('reports an unknown error when the last failure is not an Error', async () => {
      const service = new AiService([
        createProvider('groq', {
          chatComplete: () => Promise.reject({ status: 503 }),
        }),
      ]);

      await expect(service.chatComplete(MESSAGES)).rejects.toThrow(
        'Todos los proveedores de IA fallaron. Último error: Unknown error',
      );
    });

    it('sanitizes provider secrets in the fallback log and final error', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const service = new AiService([
        createProvider('groq', {
          chatComplete: () =>
            Promise.reject(
              Object.assign(
                new Error('429 Authorization: Bearer gsk_live_secret123'),
                { status: 429 },
              ),
            ),
        }),
      ]);

      await expect(service.chatComplete(MESSAGES)).rejects.toThrow(
        'Authorization: Bearer [redacted]',
      );
      const logLine = warn.mock.calls
        .map(([line]) => (typeof line === 'string' ? line : ''))
        .find((line) => line.startsWith('AI provider failure '));
      expect(logLine).toBeDefined();
      expect(logLine).not.toContain('gsk_live_secret123');
    });
  });

  describe('complete', () => {
    it('returns the neutral completion without provider metadata', async () => {
      const service = new AiService([
        createProvider('groq', {
          chatComplete: () => Promise.resolve(completion('neutral')),
        }),
      ]);

      await expect(service.complete(MESSAGES)).resolves.toEqual({
        content: 'neutral',
        provider: 'groq',
        model: 'groq-model',
      });
    });
  });
});
