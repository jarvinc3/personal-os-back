import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AiProcessingJob } from '../../core/queues/queue-jobs';
import { QueueNames } from '../../core/queues/queue.constants';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { parseUserPreferences } from '../users/lib/parse-user-preferences';
import { UsersRepository } from '../users/users.repository';
import { AiMemoryService } from './ai-memory.service';
import { AiSessionsRepository } from './ai-sessions.repository';
import { AiService } from './ai.service';
import { buildAgentPrompt } from './prompts/build-agent-prompt';
import type { AiResponseWsPayload } from './utils/ai.types';

@Injectable()
@Processor(QueueNames.AI_PROCESSING)
export class AiProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessingProcessor.name);

  constructor(
    private readonly aiService: AiService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly usersRepository: UsersRepository,
    private readonly sessionsRepo: AiSessionsRepository,
    private readonly memoryService: AiMemoryService,
  ) {
    super();
  }

  async process(job: Job<AiProcessingJob>): Promise<void> {
    const { userId, actionType, payload } = job.data;

    if (actionType === 'session.summarize') {
      const sessionId = payload.sessionId as string;
      await this.memoryService.maybeSummarizeSession(sessionId, userId);
      return;
    }

    if (actionType === 'user.preferences.updated') {
      this.emit(userId, {
        type: 'action.updated',
        actionType,
        sideEffects: [{ type: 'invalidate', keys: ['profile', 'me'] }],
      });
      return;
    }

    const user = await this.usersRepository.findById(userId);
    if (!user) {
      this.logger.warn(`AI job skipped: user ${userId} not found`);
      return;
    }

    const prefs = parseUserPreferences(user.preferences, user.timezone);
    if (!prefs.ai.proactiveInsights) {
      this.logger.debug(
        `AI job skipped for user ${userId}: proactiveInsights disabled`,
      );
      return;
    }

    const moduleSlug =
      typeof payload.slug === 'string' ? payload.slug : null;

    const systemContent = buildAgentPrompt({
      tone: prefs.ai.tone,
      locale: user.locale,
      confirmBeforeActions: prefs.ai.confirmBeforeActions,
      memorySnapshot: {},
      moduleSlug,
    });

    const insightPrompts: Record<string, string> = {
      'user.logged_in':
        'The user just logged in. Offer one short helpful tip about Personal OS settings, or a brief welcome.',
      'module.enabled': `The user enabled the ${moduleSlug ?? 'unknown'} module. Suggest one initial configuration tip.`,
      'module.disabled': `The user disabled the ${moduleSlug ?? 'unknown'} module. Acknowledge briefly.`,
      'module.config.updated': `The user updated ${moduleSlug ?? 'unknown'} module config. Offer one relevant tip.`,
      'transaction.created':
        'The user recorded a new finance transaction. Offer one brief, actionable insight if useful.',
      'transaction.updated':
        'The user updated a finance transaction. Acknowledge briefly if a tip is useful.',
      'budget.threshold_reached':
        'A budget threshold was reached. Offer one concise spending tip related to staying on budget.',
    };

    const userPrompt =
      insightPrompts[actionType] ??
      `Generate a brief proactive insight for event "${actionType}" with payload: ${JSON.stringify(payload)}`;

    const { provider, model, content } = await this.aiService.chatComplete(
      [
        { role: 'system', content: systemContent },
        { role: 'user', content: userPrompt },
      ],
      prefs.ai.defaultProvider,
    );

    const session = await this.sessionsRepo.createSessionWithModule(
      userId,
      'insight',
      null,
    );

    await this.sessionsRepo.createMessage({
      sessionId: session.id,
      role: 'assistant',
      content,
      metadata: { provider, model, source: 'insight', actionType },
    });

    this.emit(userId, {
      type: 'insight',
      sessionId: session.id,
      provider,
      model,
      content,
      actionType,
      source: 'queue',
    });
  }

  private emit(userId: string, payload: AiResponseWsPayload) {
    this.notificationsGateway.emitToUser(
      userId,
      'ai.response',
      payload,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AiProcessingJob>, error: Error) {
    this.logger.error(`AI processing job ${job.id ?? 'unknown'} failed: ${error.message}`);
  }
}
