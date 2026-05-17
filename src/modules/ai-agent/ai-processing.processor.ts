import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueNames } from '../../core/queues/queue.constants';
import { AiProcessingJob } from '../../core/queues/queue-jobs';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { AiService } from './ai.service';

@Injectable()
@Processor(QueueNames.AI_PROCESSING)
export class AiProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessingProcessor.name);

  constructor(
    private readonly aiService: AiService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {
    super();
  }

  async process(job: Job<AiProcessingJob>): Promise<void> {
    const { userId, actionType, payload } = job.data;

    const { provider, model, stream } = await this.aiService.chat([
      {
        role: 'system',
        content: 'You are the Personal OS assistant. Respond concisely.',
      },
      {
        role: 'user',
        content: `Process action "${actionType}" with payload: ${JSON.stringify(payload)}`,
      },
    ]);

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
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AiProcessingJob>, error: Error) {
    this.logger.error(`AI processing job ${job.id ?? 'unknown'} failed: ${error.message}`);
  }
}
