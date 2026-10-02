import { Module } from '@nestjs/common';
import { DomainEventIdempotencyGuard } from '@personal-os/core';
import { DOMAIN_EVENT_PUBLISHER } from '../shared/application/tokens';
import { FinanceOutboxDispatcher } from './infrastructure/finance-outbox.dispatcher';
import { PrismaOutboxRepository } from './infrastructure/prisma-outbox.repository';

@Module({
  providers: [
    PrismaOutboxRepository,
    {
      provide: DOMAIN_EVENT_PUBLISHER,
      useExisting: PrismaOutboxRepository,
    },
    FinanceOutboxDispatcher,
    DomainEventIdempotencyGuard,
  ],
  exports: [
    DOMAIN_EVENT_PUBLISHER,
    PrismaOutboxRepository,
    FinanceOutboxDispatcher,
    DomainEventIdempotencyGuard,
  ],
})
export class FinanceEventsModule {}
