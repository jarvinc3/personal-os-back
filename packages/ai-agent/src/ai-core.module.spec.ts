import { Test } from '@nestjs/testing';
import { INFERENCE_COMPLETION } from '@personal-os/contracts';
import type { InferenceCompletionPort } from '@personal-os/contracts';
import { AiCoreModule } from './ai-core.module';
import { AI_PROVIDER } from './shared/ai-provider.token';
import { AiService } from './inference/application/ai.service';

describe('Inference composition without chat or Finance', () => {
  it('resolves the neutral port and preserves retryable failover and attribution', async () => {
    const unavailable = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('rate limited'), { status: 429 }),
      );
    const fallback = jest.fn().mockResolvedValue({
      content: '{"amount":"250.00"}',
      toolCalls: [],
    });
    const module = await Test.createTestingModule({ imports: [AiCoreModule] })
      .overrideProvider(AI_PROVIDER)
      .useValue([
        { name: 'primary', model: 'one', chatComplete: unavailable },
        { name: 'fallback', model: 'two', chatComplete: fallback },
      ])
      .compile();
    try {
      const inference =
        module.get<InferenceCompletionPort>(INFERENCE_COMPLETION);
      expect(inference).toBe(module.get(AiService));
      const messages = Object.freeze([
        Object.freeze({ role: 'user' as const, content: 'gasto de 250' }),
      ]);
      await expect(inference.complete(messages)).resolves.toEqual({
        content: '{"amount":"250.00"}',
        provider: 'fallback',
        model: 'two',
      });
      expect(unavailable).toHaveBeenCalledWith(messages, undefined);
      expect(fallback).toHaveBeenCalledWith(messages, undefined);
    } finally {
      await module.close();
    }
  });
});
