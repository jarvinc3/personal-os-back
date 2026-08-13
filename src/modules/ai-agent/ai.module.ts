import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { FinanceEventsModule } from '../finance';
import { FinanceModule } from '../finance';
import { NotificationsModule } from '../notifications';
import { AiActionsReaperService } from './actions/application/ai-actions-reaper.service';
import { AiActionsService } from './actions/application/ai-actions.service';
import { AiActionsRepository } from './actions/infrastructure/ai-actions.repository';
import { AiActionsController } from './actions/presentation/ai-actions.controller';
import { AiAgentRunner } from './chat/application/ai-agent.runner';
import { AiChatTurnCoordinator } from './chat/application/ai-chat-turn-coordinator.service';
import { AiSessionsService } from './chat/application/ai-sessions.service';
import { AiService } from './chat/application/ai.service';
import { AiChatPersistenceService } from './chat/infrastructure/ai-chat-persistence.service';
import { AiSessionsRepository } from './chat/infrastructure/ai-sessions.repository';
import { AiSessionsController } from './chat/presentation/ai-sessions.controller';
import { AiController } from './chat/presentation/ai.controller';
import { AiEventsListener } from './runtime/application/ai-events.listener';
import { AiMemoryService } from './runtime/application/ai-memory.service';
import { AiProcessingProcessor } from './runtime/application/ai-processing.processor';
import { AI_PROVIDER } from './shared/ai-provider.token';
import type { AIService as AIProviderClient } from './shared/ai.types';
import { ToolExecutorService } from './tools/tool-executor.service';

@Module({
  imports: [
    NotificationsModule,
    FinanceEventsModule,
    forwardRef(() => FinanceModule),
  ],
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
    AiChatTurnCoordinator,
    AiService,
    AiAgentRunner,
    ToolExecutorService,
    AiActionsRepository,
    AiActionsService,
    AiActionsReaperService,
    AiMemoryService,
    AiEventsListener,
    AiProcessingProcessor,
  ],
  exports: [AiService, AiSessionsService, AiAgentRunner],
})
export class AiModule {}
