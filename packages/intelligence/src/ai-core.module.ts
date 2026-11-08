import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import {
  AI_CONVERSATION_INFERENCE,
  AI_CAPABILITY_REGISTRY,
  INFERENCE_COMPLETION,
} from '@personal-os/contracts';
import { AiInferenceGateway } from './inference/application/ai-inference.gateway';
import { InferenceCompletionAdapter } from './inference/application/inference-completion.adapter';
import { AiService } from './inference/application/ai.service';
import { AiInferenceDataService } from './inference/infrastructure/ai-inference-data.service';
import { AiInferenceRetentionScheduler } from './inference/infrastructure/ai-inference-retention.scheduler';
import { createAiProviderPool } from './inference/ai-provider-pool';
import { AI_PROVIDER } from './shared/ai-provider.token';
import { AiRolesController } from './roles/ai-roles.controller';
import { AiRolesService } from './roles/ai-roles.service';
import { RolesGuard } from './roles/roles.guard';
import { AiConsentController } from './consent/ai-consent.controller';
import { AiConsentService } from './consent/ai-consent.service';
import { AiIntelligenceController } from './email/ai-intelligence.controller';
import { AiEmailSourceService } from './email/ai-email-source.service';
import { AiEmailRetentionScheduler } from './email/ai-email-retention.scheduler';
import { GmailSyncService } from './email/gmail-sync.service';
import { AiEvidenceController } from './evidence/ai-evidence.controller';
import { AiEvidenceService } from './evidence/ai-evidence.service';
import { AiKnowledgeService } from './knowledge/ai-knowledge.service';
import { AiDataDeletionService } from './knowledge/ai-data-deletion.service';
import { AiKnowledgeController } from './knowledge/ai-knowledge.controller';
import { AiEmailClassificationService } from './email/ai-email-classification.service';
import { AiEmailReclassificationService } from './email/email-reclassification.service';
import { BullModule } from '@nestjs/bullmq';
import { isBullMqEnabledFromProcessEnv } from '@personal-os/config';
import { QueueNames } from '@personal-os/core';
import { AiSignalsController } from './signals/ai-signals.controller';
import { AiSignalsService } from './signals/ai-signals.service';
import { AiSignalOutboxBridge } from './signals/ai-signal-outbox.bridge';
import { AiCapabilityRegistry } from './capabilities/ai-capability.registry';
import { AiConversationController } from './conversations/presentation/ai-conversation.controller';
import { AiConversationStore } from './conversations/application/ai-conversation.store';
import { AiOrchestrator } from './conversations/application/ai.orchestrator';
import { AiInferenceAdapter } from './conversations/infrastructure/ai-inference.adapter';
import { AiConversationDataService } from './conversations/application/ai-conversation-data.service';
import { AiContextAssembler } from './conversations/application/ai-context-assembler';
import { AiActionsController } from './actions/presentation/ai-actions.controller';
import { AiActionsRepository } from './actions/infrastructure/ai-actions.repository';
import { AiActionsReaperService } from './actions/infrastructure/ai-actions-reaper.service';
import { AiActionPolicyService } from './actions/application/ai-action-policy.service';
import { AiActionsService } from './actions/application/ai-actions.service';
import { AiSignalConsumerRegistry } from './signals/ai-signal-consumer.registry';
import { AiSignalRoutingProcessor } from './signals/ai-signal-routing.processor';

const bullMqEnabled = isBullMqEnabledFromProcessEnv();

/**
 * Provider kernel with no Finance/Notifications imports.
 * Global so Finance injects the neutral inference port without importing AI.
 */
@Global()
@Module({
  imports: [
    ...(bullMqEnabled
      ? [BullModule.registerQueue({ name: QueueNames.AI_SIGNAL_ROUTING })]
      : []),
  ],
  controllers: [
    AiRolesController,
    AiConsentController,
    AiIntelligenceController,
    AiEvidenceController,
    AiKnowledgeController,
    AiSignalsController,
    AiConversationController,
    AiActionsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: RolesGuard },
    RolesGuard,
    AiRolesService,
    AiConsentService,
    AiEmailSourceService,
    AiEmailRetentionScheduler,
    AiEmailClassificationService,
    AiEmailReclassificationService,
    AiSignalsService,
    AiSignalOutboxBridge,
    AiSignalConsumerRegistry,
    ...(bullMqEnabled ? [AiSignalRoutingProcessor] : []),
    AiCapabilityRegistry,
    AiActionsRepository,
    AiActionPolicyService,
    AiActionsService,
    AiActionsReaperService,
    { provide: AI_CAPABILITY_REGISTRY, useExisting: AiCapabilityRegistry },
    AiConversationStore,
    AiContextAssembler,
    AiOrchestrator,
    AiInferenceAdapter,
    { provide: AI_CONVERSATION_INFERENCE, useExisting: AiInferenceAdapter },
    AiConversationDataService,
    GmailSyncService,
    AiEvidenceService,
    AiKnowledgeService,
    AiDataDeletionService,
    {
      provide: AI_PROVIDER,
      useFactory: (config: ConfigService<Env, true>) =>
        createAiProviderPool({
          groqApiKey: config.get('GROQ_API_KEY', { infer: true }),
          openRouterApiKey: config.get('OPENROUTER_API_KEY', { infer: true }),
        }),
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
    AiCapabilityRegistry,
    AiActionsService,
    AiActionsRepository,
    AI_CAPABILITY_REGISTRY,
    AI_CONVERSATION_INFERENCE,
    AiConversationDataService,
    AiConversationStore,
    AiSignalsService,
    AiSignalConsumerRegistry,
    AiRolesService,
    AiConsentService,
    AiEmailSourceService,
    AiService,
    AiInferenceGateway,
    AiInferenceDataService,
    INFERENCE_COMPLETION,
  ],
})
export class AiCoreModule {}
