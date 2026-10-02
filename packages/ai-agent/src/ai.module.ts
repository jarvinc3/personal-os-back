import { Module } from '@nestjs/common';
import { FinanceEventsModule, FinanceModule } from '@personal-os/finance';
import { NotificationsModule } from '@personal-os/notifications';
import { AiActionsReaperService } from './actions/application/ai-actions-reaper.service';
import { AiActionsService } from './actions/application/ai-actions.service';
import { AiActionsRepository } from './actions/infrastructure/ai-actions.repository';
import { AiActionsController } from './actions/presentation/ai-actions.controller';
import { AiCoreModule } from './ai-core.module';
import { AiAgentRunner } from './chat/application/ai-agent.runner';
import { AiChatTurnCoordinator } from './chat/application/ai-chat-turn-coordinator.service';
import { AiSessionsService } from './chat/application/ai-sessions.service';
import { AiChatPersistenceService } from './chat/infrastructure/ai-chat-persistence.service';
import { AiSessionsRepository } from './chat/infrastructure/ai-sessions.repository';
import { AiSessionsController } from './chat/presentation/ai-sessions.controller';
import { AiController } from './chat/presentation/ai.controller';
import { AiEventsListener } from './runtime/application/ai-events.listener';
import { AiMemoryService } from './runtime/application/ai-memory.service';
import { AiProcessingProcessor } from './runtime/application/ai-processing.processor';
import { ToolExecutorService } from './tools/tool-executor.service';

@Module({
  imports: [
    AiCoreModule,
    NotificationsModule,
    FinanceEventsModule,
    FinanceModule,
  ],
  controllers: [AiController, AiSessionsController, AiActionsController],
  providers: [
    AiSessionsRepository,
    AiSessionsService,
    AiChatPersistenceService,
    AiChatTurnCoordinator,
    AiAgentRunner,
    ToolExecutorService,
    AiActionsRepository,
    AiActionsService,
    AiActionsReaperService,
    AiMemoryService,
    AiEventsListener,
    AiProcessingProcessor,
  ],
  exports: [AiCoreModule, AiSessionsService, AiAgentRunner],
})
export class AiModule {}
