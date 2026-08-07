import { DomainEventIdempotencyGuard } from './domain-event-idempotency.guard';

describe('DomainEventIdempotencyGuard', () => {
  const create = jest.fn();
  const findUnique = jest.fn();
  const prisma = {
    processedDomainEvent: { create, findUnique },
  };
  const guard = new DomainEventIdempotencyGuard(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows processing when eventId is missing', async () => {
    await expect(guard.tryClaim(undefined, 'notifications')).resolves.toBe(true);
    expect(create.mock.calls).toHaveLength(0);
  });

  it('claims successfully on first insert', async () => {
    create.mockResolvedValue({ eventId: 'e1', consumer: 'notifications' });
    await expect(guard.tryClaim('e1', 'notifications')).resolves.toBe(true);
    expect(create.mock.calls).toEqual([
      [{ data: { eventId: 'e1', consumer: 'notifications' } }],
    ]);
  });

  it('returns false when already processed', async () => {
    create.mockRejectedValue(new Error('unique'));
    findUnique.mockResolvedValue({ eventId: 'e1', consumer: 'notifications' });
    await expect(guard.tryClaim('e1', 'notifications')).resolves.toBe(false);
  });

  it('returns true when create failed but no row exists (race-safe retry)', async () => {
    create.mockRejectedValue(new Error('transient'));
    findUnique.mockResolvedValue(null);
    await expect(guard.tryClaim('e2', 'ai')).resolves.toBe(true);
  });
});
