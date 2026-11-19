import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { INFERENCE_COMPLETION } from '@personal-os/contracts';
import type { InferenceCompletionPort } from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';
import { AiCoreModule } from './ai-core.module';
import { AI_PROVIDER } from './shared/ai-provider.token';
import { InferenceCompletionAdapter } from './inference/application/inference-completion.adapter';

@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: {
        getOrThrow: () => 'test-data-encryption-key-long-enough',
        get: (key: string) =>
          ({
            AI_EMAIL_CLASSIFICATIONS_PER_MINUTE: 20,
            AI_EMAIL_INITIAL_BUDGET: 500,
            AI_EMAIL_DAILY_TOKEN_BUDGET: 320_000,
            AI_EMAIL_DAILY_COST_LIMIT_USD: 5,
            AI_EMAIL_COST_ALERT_RATIO: 0.8,
            AI_EMAIL_MAX_CONTENT_CHARS: 24_000,
            AI_EMAIL_MAX_SUBJECT_CHARS: 1_000,
            AI_EMAIL_MAX_SENDER_CHARS: 320,
            AI_EMAIL_BANK_SENDER_DOMAINS: ['bhd.com.do'],
            AI_PROVIDER_RPM_GROQ: 30,
            AI_PROVIDER_RPM_OPENROUTER: 20,
          })[key],
      },
    },
    {
      provide: PrismaService,
      useValue: { aiInference: { create: jest.fn() } },
    },
  ],
  exports: [ConfigService, PrismaService],
})
class AiTestDependenciesModule {}

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
    const module = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        AiTestDependenciesModule,
        AiCoreModule,
      ],
    })
      .overrideProvider(AI_PROVIDER)
      .useValue([
        { name: 'primary', model: 'one', chatComplete: unavailable },
        { name: 'fallback', model: 'two', chatComplete: fallback },
      ])
      .compile();
    try {
      const inference =
        module.get<InferenceCompletionPort>(INFERENCE_COMPLETION);
      expect(inference).toBe(module.get(InferenceCompletionAdapter));
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
