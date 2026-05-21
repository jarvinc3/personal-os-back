import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueNames } from '../../core/queues/queue.constants';
import { AiProcessingJob } from '../../core/queues/queue-jobs';
import { parseUserPreferences } from '../users/lib/parse-user-preferences';
import { UsersRepository } from '../users/users.repository';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { buildSystemPrompt } from './lib/build-system-prompt';
import { AiService } from './ai.service';

@Injectable()
@Processor(QueueNames.AI_PROCESSING)
export class AiProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessingProcessor.name);

  constructor(
    private readonly aiService: AiService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly usersRepository: UsersRepository,
  ) {
    super();
  }

  async process(job: Job<AiProcessingJob>): Promise<void> {
    const { userId, actionType, payload } = job.data;

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

    const systemContent = buildSystemPrompt({
      tone: prefs.ai.tone,
      locale: user.locale,
      confirmBeforeActions: prefs.ai.confirmBeforeActions,
    });

    const { provider, model, stream } = await this.aiService.chat(
      [
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content: `Process action "${actionType}" with payload: ${JSON.stringify(payload)}`,
        },
      ],
      prefs.ai.defaultProvider,
    );

    let content = '';
    for await (const chunk of stream) {
      content += chunk;
    }

    this.notificationsGateway.emitToUser(userId, 'ai.response', {
      provider,
      model,
      content,
      actionType,
      source: 'queue',
      requiresConfirmation: prefs.ai.confirmBeforeActions,
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AiProcessingJob>, error: Error) {
    this.logger.error(`AI processing job ${job.id ?? 'unknown'} failed: ${error.message}`);
  }
}
