import { Test } from '@nestjs/testing';
import {
  DOMAIN_EVENT_OUTBOX_READER,
  DOMAIN_EVENT_PUBLISHER,
  DOMAIN_EVENT_RELAY,
} from '@personal-os/contracts';
import { DomainEventIdempotencyGuard } from './domain-event-idempotency.guard';
import { DomainEventsModule } from './domain-events.module';
import { OutboxRelay } from './outbox/outbox-relay';
import { PrismaDomainEventOutbox } from './outbox/prisma-domain-event-outbox';

describe('DomainEventsModule', () => {
  it('gives any domain the shared publisher, reader and relay ports', async () => {
    const outbox = { enqueue: jest.fn(), hasEvent: jest.fn() };
    const relay = { wake: jest.fn() };
    const module = await Test.createTestingModule({
      imports: [DomainEventsModule],
    })
      .overrideProvider(PrismaDomainEventOutbox)
      .useValue(outbox)
      .overrideProvider(OutboxRelay)
      .useValue(relay)
      .overrideProvider(DomainEventIdempotencyGuard)
      .useValue({})
      .compile();

    expect(module.get(DOMAIN_EVENT_PUBLISHER)).toBe(outbox);
    expect(module.get(DOMAIN_EVENT_OUTBOX_READER)).toBe(outbox);
    expect(module.get(DOMAIN_EVENT_RELAY)).toBe(relay);
    expect(module.get(DomainEventIdempotencyGuard)).toBeDefined();
  });
});
