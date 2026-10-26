import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { AiRolesController } from './intelligence/roles/ai-roles.controller';
import { AiRolesService } from './intelligence/roles/ai-roles.service';
import { RolesGuard } from './intelligence/roles/roles.guard';
import { AiConsentController } from './intelligence/consent/ai-consent.controller';
import { AiConsentService } from './intelligence/consent/ai-consent.service';
import { AiIntelligenceController } from './intelligence/email/ai-intelligence.controller';
import { AiEmailSourceService } from './intelligence/email/ai-email-source.service';
import { AiEmailRetentionScheduler } from './intelligence/email/ai-email-retention.scheduler';
import { GmailSyncService } from './intelligence/email/gmail-sync.service';
import { AiEvidenceController } from './intelligence/evidence/ai-evidence.controller';
import { AiEvidenceService } from './intelligence/evidence/ai-evidence.service';
import { AiKnowledgeService } from './intelligence/knowledge/ai-knowledge.service';
import { AiDataDeletionService } from './intelligence/knowledge/ai-data-deletion.service';
import { AiKnowledgeController } from './intelligence/knowledge/ai-knowledge.controller';

/**
 * Provider kernel with no Finance/Notifications imports.
 * Global so Finance injects the neutral inference port without importing AI.
 */
@Global()
@Module({
  controllers: [
    AiRolesController,
    AiConsentController,
    AiIntelligenceController,
    AiEvidenceController,
    AiKnowledgeController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: RolesGuard },
    RolesGuard,
    AiRolesService,
    AiConsentService,
    AiEmailSourceService,
    AiEmailRetentionScheduler,
    GmailSyncService,
    AiEvidenceService,
    AiKnowledgeService,
    AiDataDeletionService,
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
