import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AiProcessingJob } from '../../core/queues/queue-jobs';
import { QueueNames } from '../../core/queues/queue.constants';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { parseUserPreferences } from '../users/lib/parse-user-preferences';
import { UsersRepository } from '../users/users.repository';
import { resolveDailyInsightQuota } from './ai-limits';
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

    const quota = resolveDailyInsightQuota();
    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);
    const usedToday = await this.sessionsRepo.countInsightMessagesSince(
      userId,
      startOfUtcDay,
    );
    if (usedToday >= quota) {
      this.logger.warn(
        `AI insight skipped for user ${userId}: daily quota ${quota} reached`,
      );
      return;
    }

    const moduleSlug =
      typeof payload.slug === 'string' ? payload.slug : null;

    const field = (key: string, fallback = '?'): string => {
      const value = payload[key];
      if (value === null || value === undefined) return fallback;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      return JSON.stringify(value);
    };

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
      'finance.transaction.confirmed':
        `The user recorded a finance transaction id=${field('transactionId')} amount=${field('amount')} status=${field('status')}. Offer one brief, actionable insight if useful.`,
      'finance.transaction.updated':
        `The user updated finance transaction id=${field('transactionId')}. Acknowledge briefly if a tip is useful.`,
      'finance.budget.threshold_crossed':
        `Budget ${field('budgetId')} reached ${field('percentageUsed')}%. Offer one concise spending tip related to staying on budget.`,
      'finance.email_sync.completed':
        `Gmail bank sync finished for source ${field('sourceId')}: ${field('transactionsNew', '0')} new of ${field('emailsScanned', '0')} scanned. Status mix: ${field('countsByStatus', '{}')}. Summarize and suggest confirming any PENDING imports.`,
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

    const existingInsight =
      await this.sessionsRepo.findLatestInsightSession(userId);
    const session =
      existingInsight ??
      (await this.sessionsRepo.createSessionWithModule(
        userId,
        'insight',
        null,
      ));

    if (existingInsight) {
      await this.sessionsRepo.touchSession(session.id);
    }

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
