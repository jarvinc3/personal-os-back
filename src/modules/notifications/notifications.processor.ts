import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QueueNames } from '../../core/queues/queue.constants';
import {
  EmailSyncJob,
  NotificationDispatchJob,
} from '../../core/queues/queue-jobs';
import { NotificationPolicyService } from './notification-policy.service';
import { NotificationsRepository } from './notifications.repository';
import { PushSenderService } from './push-sender.service';

@Injectable()
@Processor(QueueNames.NOTIFICATIONS)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly notificationsRepo: NotificationsRepository,
    private readonly notificationPolicy: NotificationPolicyService,
    private readonly pushSender: PushSenderService,
    @Optional()
    @InjectQueue(QueueNames.EMAIL_SYNC)
    private readonly emailSyncQueue?: Queue<EmailSyncJob>,
  ) {
    super();
  }

  async process(job: Job<NotificationDispatchJob>): Promise<void> {
    const payload = job.data;

    const policy = await this.notificationPolicy.evaluate({
      userId: payload.userId,
      channel: payload.channel,
      data: payload.data,
    });

    if (!policy.allowed) {
      this.notificationPolicy.logSkipped(
        {
          userId: payload.userId,
          channel: payload.channel,
          data: payload.data,
        },
        policy.reason,
      );
      return;
    }

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
        const tokenValues = activeTokens.map((row) => row.token);

        if (tokenValues.length === 0) {
          this.logger.warn(
            `PUSH notification ${payload.notificationId}: no active tokens for user ${payload.userId}`,
          );
          return;
        }

        const result = await this.pushSender.sendToTokens(tokenValues, {
          title: payload.title,
          body: payload.body,
          data: {
            notificationId: payload.notificationId,
            ...(payload.data ?? {}),
          },
        });

        this.logger.log(
          `PUSH notification ${payload.notificationId}: sent=${result.sent} failed=${result.failed}`,
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
