import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { INFERENCE_COMPLETION } from '@personal-os/contracts';
import { AiInferenceGateway } from './inference/application/ai-inference.gateway';
import { InferenceCompletionAdapter } from './inference/application/inference-completion.adapter';
import { AiService } from './inference/application/ai.service';
import { AiInferenceDataService } from './inference/infrastructure/ai-inference-data.service';
import { AiInferenceRetentionScheduler } from './inference/infrastructure/ai-inference-retention.scheduler';
import { AI_PROVIDER } from './shared/ai-provider.token';
import type { AIService as AIProviderClient } from './shared/ai.types';

/**
 * Provider kernel with no Finance/Notifications imports.
 * Global so Finance injects the neutral inference port without importing AI.
 */
@Global()
@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      useFactory: (config: ConfigService<Env, true>) => {
        const providers: AIProviderClient[] = [];
        const groqKey = config.get('GROQ_API_KEY', { infer: true });
        const openRouterKey = config.get('OPENROUTER_API_KEY', {
          infer: true,
        });

        if (groqKey) {
          const { createGroqProvider } =
            require('./providers/groq.provider') as {
              createGroqProvider: (apiKey: string) => AIProviderClient;
            };
          providers.push(createGroqProvider(groqKey));
        }
        if (openRouterKey) {
          const { createOpenRouterProvider } =
            require('./providers/openrouter.provider') as {
              createOpenRouterProvider: (apiKey: string) => AIProviderClient;
            };
          providers.push(createOpenRouterProvider(openRouterKey));
        }
        return providers;
      },
      inject: [ConfigService],
    },
    AiService,
    AiInferenceGateway,
    InferenceCompletionAdapter,
    AiInferenceDataService,
    AiInferenceRetentionScheduler,
    {
      provide: INFERENCE_COMPLETION,
      useExisting: InferenceCompletionAdapter,
    },
  ],
  exports: [
    AiService,
    AiInferenceGateway,
    AiInferenceDataService,
    INFERENCE_COMPLETION,
  ],
})
export class AiCoreModule {}
