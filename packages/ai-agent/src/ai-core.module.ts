import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { AI_CHAT_COMPLETION } from '@personal-os/core';
import { AiService } from './chat/application/ai.service';
import { AI_PROVIDER } from './shared/ai-provider.token';
import type { AIService as AIProviderClient } from './shared/ai.types';

/**
 * Provider kernel with no Finance/Notifications imports.
 * Global so Finance ingestion injects the chat port without importing this package.
 */
@Global()
@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      useFactory: (config: ConfigService<Env, true>) => {
        const providers: AIProviderClient[] = [];
        const groqKey = config.get('GROQ_API_KEY', { infer: true });
        const openCodeKey = config.get('OPENCODE_API_KEY', { infer: true });
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
        if (openCodeKey) {
          const { createOpenCodeProvider } =
            require('./providers/opencode.provider') as {
              createOpenCodeProvider: (apiKey: string) => AIProviderClient;
            };
          providers.push(createOpenCodeProvider(openCodeKey));
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
    {
      provide: AI_CHAT_COMPLETION,
      useExisting: AiService,
    },
  ],
  exports: [AiService, AI_CHAT_COMPLETION],
})
export class AiCoreModule {}
