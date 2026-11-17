import { Module } from '@nestjs/common';
import {
  DOMAIN_EVENT_OUTBOX_READER,
  DOMAIN_EVENT_PUBLISHER,
  DOMAIN_EVENT_RELAY,
} from '@personal-os/contracts';
import { DomainEventIdempotencyGuard } from './domain-event-idempotency.guard';
import { OutboxRelay } from './outbox/outbox-relay';
import { PrismaDomainEventOutbox } from './outbox/prisma-domain-event-outbox';

/**
 * Shared event transport. Domains keep their event names and payloads; they
 * only depend on these ports.
 */
@Module({
  providers: [
    PrismaDomainEventOutbox,
    {
      provide: DOMAIN_EVENT_PUBLISHER,
      useExisting: PrismaDomainEventOutbox,
    },
    {
      provide: DOMAIN_EVENT_OUTBOX_READER,
      useExisting: PrismaDomainEventOutbox,
    },
    OutboxRelay,
    {
      provide: DOMAIN_EVENT_RELAY,
      useExisting: OutboxRelay,
    },
    DomainEventIdempotencyGuard,
  ],
  exports: [
    DOMAIN_EVENT_PUBLISHER,
    DOMAIN_EVENT_OUTBOX_READER,
    DOMAIN_EVENT_RELAY,
    PrismaDomainEventOutbox,
    OutboxRelay,
    DomainEventIdempotencyGuard,
  ],
})
export class DomainEventsModule {}
