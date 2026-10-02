import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import {
  EmailSyncJob,
  NotificationDispatchJob,
} from '../../../core/queues/queue-jobs';
import { QueueNames } from '../../../core/queues/queue.constants';
import { NotificationsRepository } from '../infrastructure/notifications.repository';
import { PushSenderService } from '../infrastructure/push-sender.service';

@Injectable()
@Processor(QueueNames.NOTIFICATIONS)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly notificationsRepo: NotificationsRepository,
    private readonly pushSender: PushSenderService,
    @Optional()
    @InjectQueue(QueueNames.EMAIL_SYNC)
    private readonly emailSyncQueue?: Queue<EmailSyncJob>,
  ) {
    super();
  }

  async process(job: Job<NotificationDispatchJob>): Promise<void> {
    const payload = job.data;

    // Policy already evaluated at create time; processor trusts the job.
    switch (payload.channel) {
      case 'IN_APP':
        this.logger.debug(
          `Notification ${payload.notificationId} is IN_APP (already delivered via WebSocket)`,
        );
        return;

      case 'PUSH': {
        const activeTokens = await this.notificationsRepo.findActivePushTokens(
          payload.userId,
        );

        if (activeTokens.length === 0) {
          this.logger.warn(
            `PUSH notification ${payload.notificationId}: no active tokens for user ${payload.userId}`,
          );
          return;
        }

        const result = await this.pushSender.sendToTokenEntries(activeTokens, {
          title: payload.title,
          body: payload.body,
          data: {
            notificationId: payload.notificationId,
            ...(payload.data ?? {}),
          },
        });

        if (result.deactivatedTokens.length > 0) {
          await this.pushSender.deactivateInvalidTokens(result.deactivatedTokens);
        }

        this.logger.log(
          `PUSH notification ${payload.notificationId}: sent=${result.sent} failed=${result.failed} deactivated=${result.deactivatedTokens.length}`,
        );
        return;
      }

      case 'EMAIL': {
        if (!this.emailSyncQueue) {
          this.logger.warn(
            `EMAIL notification ${payload.notificationId} skipped: email-sync queue unavailable`,
          );
          return;
        }

        await this.emailSyncQueue.add(
          'send-notification-email',
          {
            userId: payload.userId,
            template: 'notification',
            to: '',
            subject: payload.title,
            body: payload.body,
            data: payload.data,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 100,
            removeOnFail: 300,
          },
        );

        this.logger.log(
          `EMAIL notification ${payload.notificationId} forwarded to email-sync queue`,
        );
        return;
      }
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<NotificationDispatchJob>, error: Error) {
    this.logger.error(
      `Notification job ${job.id ?? 'unknown'} failed: ${error.message}`,
    );
  }
}
