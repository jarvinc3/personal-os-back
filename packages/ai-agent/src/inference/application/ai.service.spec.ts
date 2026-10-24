/* eslint-disable @typescript-eslint/prefer-promise-reject-errors -- providers may reject with non-Error values and the pool must survive them */
import { ServiceUnavailableException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { AiService } from './ai.service';
import type {
  AIService as AIProviderClient,
  ChatCompletionResult,
  ChatMessage,
} from '../../shared/ai.types';

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'Hola' }];

const NON_RETRYABLE_STATUS = 400;
const RETRYABLE_STATUS = 429;

function createStream(chunks: string[]): AsyncIterable<string> {
  return Readable.from(chunks);
}

function createProvider(
  name: string,
  extras: Partial<AIProviderClient> = {},
): AIProviderClient {
  return {
    name,
    model: `${name}-model`,
    chat: () => Promise.resolve(createStream([name])),
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

  it('exposes the configured providers', () => {
    const service = new AiService([
      createProvider('groq'),
      createProvider('fallback'),
    ]);

    expect(service.getProviders()).toEqual([
      { name: 'groq', model: 'groq-model' },
      { name: 'fallback', model: 'fallback-model' },
    ]);
  });

  describe('chat', () => {
    it('rejects when there is no provider available', async () => {
      const service = new AiService([]);

      await expect(service.chat(MESSAGES)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('rotates providers between calls', async () => {
      const service = new AiService([
        createProvider('groq'),
        createProvider('fallback'),
      ]);

      await expect(service.chat(MESSAGES)).resolves.toMatchObject({
        provider: 'groq',
      });
      await expect(service.chat(MESSAGES)).resolves.toMatchObject({
        provider: 'fallback',
      });
      await expect(service.chat(MESSAGES)).resolves.toMatchObject({
        provider: 'groq',
      });
    });

    it('moves the preferred provider to the front', async () => {
      const service = new AiService([
        createProvider('groq'),
        createProvider('fallback'),
      ]);

      await expect(service.chat(MESSAGES, 'Fallback')).resolves.toMatchObject({
        provider: 'fallback',
      });
      await expect(service.chat(MESSAGES, 'fallback')).resolves.toMatchObject({
        provider: 'fallback',
      });
    });

    it('ignores an unknown preferred provider', async () => {
      const service = new AiService([
        createProvider('groq'),
        createProvider('fallback'),
      ]);

      await expect(service.chat(MESSAGES, 'unknown')).resolves.toMatchObject({
        provider: 'groq',
      });
    });

    it('returns the stream of the first healthy provider', async () => {
      const service = new AiService([createProvider('groq')]);

      const chatResult = await service.chat(MESSAGES);
      const chunks: string[] = [];
      for await (const chunk of chatResult.stream) {
        chunks.push(chunk);
      }

      expect(chatResult).toMatchObject({
        provider: 'groq',
        model: 'groq-model',
      });
      expect(chunks).toEqual(['groq']);
    });

    it('retries the next provider after a retryable failure', async () => {
      const next = createProvider('fallback');
      const service = new AiService([
        createProvider('groq', {
          chat: () => Promise.reject(providerError(RETRYABLE_STATUS)),
        }),
        next,
      ]);

      await expect(service.chat(MESSAGES)).resolves.toMatchObject({
        provider: 'fallback',
      });
    });

    it('rethrows a non-retryable failure without trying the next provider', async () => {
      const nextChat = jest.fn();
      const failure = providerError(NON_RETRYABLE_STATUS);
      const service = new AiService([
        createProvider('groq', { chat: () => Promise.reject(failure) }),
        createProvider('fallback', { chat: nextChat }),
      ]);

      await expect(service.chat(MESSAGES)).rejects.toBe(failure);
      expect(nextChat).not.toHaveBeenCalled();
    });

    it('reports the last error when every provider fails', async () => {
      const service = new AiService([
        createProvider('groq', {
          chat: () => Promise.reject(providerError(RETRYABLE_STATUS)),
        }),
        createProvider('fallback', {
          chat: () => Promise.reject(providerError(503)),
        }),
      ]);

      await expect(service.chat(MESSAGES)).rejects.toThrow(
        'Todos los proveedores de IA fallaron. Último error: provider failed with status 503',
      );
    });

    it('retries when a provider rejects with a retryable plain object', async () => {
      const service = new AiService([
        createProvider('groq', {
          chat: () => Promise.reject({ status: 503 }),
        }),
        createProvider('fallback'),
      ]);

      await expect(service.chat(MESSAGES)).resolves.toMatchObject({
        provider: 'fallback',
      });
    });

    it('reports an unknown error when the last failure is not an Error', async () => {
      const service = new AiService([
        createProvider('groq', {
          chat: () => Promise.reject({ status: 503 }),
        }),
      ]);

      await expect(service.chat(MESSAGES)).rejects.toThrow(
        'Todos los proveedores de IA fallaron. Último error: Unknown error',
      );
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
        service.chatComplete(MESSAGES, 'fallback'),
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
  });

  describe('chatCompleteStream', () => {
    it('rejects when there is no provider available', async () => {
      const service = new AiService([]);

      await expect(
        service.chatCompleteStream(MESSAGES, null, undefined, jest.fn()),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('streams through the first provider with stream support', async () => {
      const stream = jest.fn(() => Promise.resolve(completion('stream')));
      const service = new AiService([
        createProvider('groq', { chatCompleteStream: stream }),
      ]);

      await expect(
        service.chatCompleteStream(MESSAGES, null, undefined, jest.fn()),
      ).resolves.toMatchObject({ provider: 'groq', content: 'stream' });
    });

    it('retries the next provider after a retryable stream failure', async () => {
      const service = new AiService([
        createProvider('groq', {
          chatCompleteStream: () =>
            Promise.reject(providerError(RETRYABLE_STATUS)),
        }),
        createProvider('fallback', {
          chatCompleteStream: () => Promise.resolve(completion('segundo')),
        }),
      ]);

      await expect(
        service.chatCompleteStream(MESSAGES, null, undefined, jest.fn()),
      ).resolves.toMatchObject({ provider: 'fallback', content: 'segundo' });
    });

    it('falls back to chatComplete and forwards its content as a token', async () => {
      const onToken = jest.fn();
      const service = new AiService([
        createProvider('groq', {
          chatCompleteStream: () =>
            Promise.reject(providerError(RETRYABLE_STATUS)),
        }),
        createProvider('fallback', {
          chatComplete: () => Promise.resolve(completion('parcial')),
        }),
      ]);

      await expect(
        service.chatCompleteStream(MESSAGES, null, undefined, onToken),
      ).resolves.toMatchObject({
        provider: 'fallback',
        content: 'parcial',
      });
      expect(onToken).toHaveBeenCalledWith('parcial');
    });

    it('does not emit a token when the fallback has no content', async () => {
      const onToken = jest.fn();
      const service = new AiService([
        createProvider('groq', {
          chatCompleteStream: () =>
            Promise.reject(providerError(RETRYABLE_STATUS)),
        }),
        createProvider('fallback', {
          chatComplete: () => Promise.resolve(completion('')),
        }),
      ]);

      await service.chatCompleteStream(MESSAGES, null, undefined, onToken);

      expect(onToken).not.toHaveBeenCalled();
    });

    it('rethrows a non-retryable stream failure', async () => {
      const failure = providerError(NON_RETRYABLE_STATUS);
      const next = createProvider('fallback', {
        chatCompleteStream: () => Promise.resolve(completion('next')),
      });
      const service = new AiService([
        createProvider('groq', {
          chatCompleteStream: () => Promise.reject(failure),
        }),
        next,
      ]);

      await expect(
        service.chatCompleteStream(MESSAGES, null, undefined, jest.fn()),
      ).rejects.toBe(failure);
    });

    it('retries the next provider when the fallback completion fails as retryable', async () => {
      const service = new AiService([
        createProvider('groq', {
          chatCompleteStream: () =>
            Promise.reject(providerError(RETRYABLE_STATUS)),
        }),
        createProvider('fallback', {
          chatComplete: () => Promise.reject(providerError(RETRYABLE_STATUS)),
        }),
        createProvider('openrouter', {
          chatComplete: () => Promise.resolve(completion('tercero')),
        }),
      ]);

      await expect(
        service.chatCompleteStream(MESSAGES, null, undefined, jest.fn()),
      ).resolves.toMatchObject({
        provider: 'openrouter',
        content: 'tercero',
      });
    });

    it('rethrows a non-retryable fallback completion failure', async () => {
      const failure = providerError(NON_RETRYABLE_STATUS);
      const service = new AiService([
        createProvider('groq', {
          chatCompleteStream: () =>
            Promise.reject(providerError(RETRYABLE_STATUS)),
        }),
        createProvider('fallback', {
          chatComplete: () => Promise.reject(failure),
        }),
      ]);

      await expect(
        service.chatCompleteStream(MESSAGES, null, undefined, jest.fn()),
      ).rejects.toBe(failure);
    });

    it('reports an unknown error when no provider supports completion', async () => {
      const service = new AiService([createProvider('groq')]);

      await expect(
        service.chatCompleteStream(MESSAGES, null, undefined, jest.fn()),
      ).rejects.toThrow(
        'Todos los proveedores de IA fallaron. Último error: Unknown error',
      );
    });

    it('retries when the last stream failure is not an Error', async () => {
      const service = new AiService([
        createProvider('groq', {
          chatCompleteStream: () => Promise.reject({ status: 503 }),
        }),
        createProvider('fallback', {
          chatCompleteStream: () => Promise.resolve(completion('segundo')),
        }),
      ]);

      await expect(
        service.chatCompleteStream(MESSAGES, null, undefined, jest.fn()),
      ).resolves.toMatchObject({
        provider: 'fallback',
        content: 'segundo',
      });
    });
  });
});
