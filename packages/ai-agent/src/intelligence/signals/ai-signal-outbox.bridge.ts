import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { QueueNames } from '@personal-os/core';

type RoutedSignalEvent = {
  eventId: string;
  userId: string;
  signalId: string;
};

@Injectable()
export class AiSignalOutboxBridge {
  private readonly logger = new Logger(AiSignalOutboxBridge.name);

  constructor(
    @Optional()
    @InjectQueue(QueueNames.AI_SIGNAL_ROUTING)
    private readonly queue?: Queue,
  ) {}

  @OnEvent('ai.signal.routed', { suppressErrors: false })
  async enqueue(event: RoutedSignalEvent) {
    if (!this.queue) {
      throw new Error('AI signal routing queue is not configured');
    }
    await this.queue.add(
      'route-signal',
      { signalId: event.signalId, userId: event.userId },
      {
        jobId: event.eventId.replaceAll(':', '_'),
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );
    this.logger.debug(`Queued signal ${event.signalId}`);
  }
}
