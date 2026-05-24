import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiActionsController } from './ai-actions.controller';
import { AiActionsRepository } from './ai-actions.repository';
import { AiActionsService } from './ai-actions.service';
import { AiAgentRunner } from './ai-agent.runner';
import { AiChatPersistenceService } from './ai-chat-persistence.service';
import { AiMemoryService } from './ai-memory.service';
import { AiProcessingProcessor } from './ai-processing.processor';
import { AiEventsListener } from './ai-events.listener';
import { AiSessionsController } from './ai-sessions.controller';
import { AiSessionsRepository } from './ai-sessions.repository';
import { AiSessionsService } from './ai-sessions.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { AI_PROVIDER } from './utils/ai-provider.token';
import type { AIService as AIProviderClient } from './utils/ai.types';

@Module({
  imports: [NotificationsModule],
  controllers: [AiController, AiSessionsController, AiActionsController],
  providers: [
    {
      provide: AI_PROVIDER,
      useFactory: (config: ConfigService<Env, true>) => {
        const providers: AIProviderClient[] = [];
        const groqKey = config.get('GROQ_API_KEY', { infer: true });
        const cerebrasKey = config.get('CEREBRAS_API_KEY', { infer: true });
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
        if (cerebrasKey) {
          const { createCerebrasProvider } =
            require('./providers/cerebras.provider') as {
              createCerebrasProvider: (apiKey: string) => AIProviderClient;
            };
          providers.push(createCerebrasProvider(cerebrasKey));
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
    AiSessionsRepository,
    AiSessionsService,
    AiChatPersistenceService,
    AiService,
    AiAgentRunner,
    ToolExecutorService,
    AiActionsRepository,
    AiActionsService,
    AiMemoryService,
    AiEventsListener,
    AiProcessingProcessor,
  ],
  exports: [AiService, AiSessionsService, AiAgentRunner],
})
export class AiModule {}
