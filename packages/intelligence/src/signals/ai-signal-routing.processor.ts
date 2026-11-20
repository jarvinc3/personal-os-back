import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { JsonObject, RoutedSignal } from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';
import { QueueNames } from '@personal-os/core';
import { AiSignalsService } from './ai-signals.service';
import { AiSignalConsumerRegistry } from './ai-signal-consumer.registry';
import { AiProactiveService } from '../proactive/ai-proactive.service';

type RouteJob = { signalId: string; userId: string };

@Injectable()
@Processor(QueueNames.AI_SIGNAL_ROUTING)
export class AiSignalRoutingProcessor extends WorkerHost {
  private readonly logger = new Logger(AiSignalRoutingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumers: AiSignalConsumerRegistry,
    private readonly signals: AiSignalsService,
    private readonly proactive: AiProactiveService,
  ) {
    super();
  }

  async process(job: Job<RouteJob>): Promise<void> {
    const row = await this.prisma.aiSignal.findFirst({
      where: { id: job.data.signalId, userId: job.data.userId },
    });
    if (!row || row.status !== 'ROUTED') {
      return;
    }
    const consumer = this.consumers.get(row.domain);
    const signal: RoutedSignal = {
      signalId: row.id,
      userId: row.userId,
      signalType: row.type,
      schemaVersion: 1,
      occurredAt: row.occurredAt.toISOString(),
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      payload: row.payload as JsonObject,
    };
    const result = await consumer.consume(signal);
    await this.signals.recordConsumerOutcome(row.userId, row.id, result);
    // La proactividad mira la señal ya consumida: su relevancia depende del
    // resultado que dejó el consumidor del dominio.
    await this.proactive.consider({
      userId: row.userId,
      signalId: row.id,
    });
    this.logger.debug(`Routed signal ${row.id}: ${result.outcome}`);
  }
}
