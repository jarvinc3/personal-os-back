import { PrismaDomainEventOutbox } from './prisma-domain-event-outbox';

describe('PrismaDomainEventOutbox', () => {
  const create = jest.fn();
  const findUnique = jest.fn();
  const prisma = {
    domainEventOutbox: { create, findUnique },
  };
  const outbox = new PrismaDomainEventOutbox(prisma as never);

  beforeEach(() => {
    create.mockReset().mockResolvedValue({});
    findUnique.mockReset();
  });

  it('writes the draft inside the caller transaction with its identity fields', async () => {
    const write = jest.fn().mockResolvedValue({});
    const tx = { domainEventOutbox: { create: write } };
    await outbox.enqueue(
      {
        eventId: 'fixed-event',
        eventName: 'domain.something.happened',
        aggregateType: 'Something',
        aggregateId: 'agg-1',
        userId: 'user-1',
        payload: { amount: 12 },
      },
      tx,
    );
    expect(prisma.domainEventOutbox.create).not.toHaveBeenCalled();
    const [written] = write.mock.calls[0] as [
      { data: { payload: Record<string, unknown> } & Record<string, unknown> },
    ];
    expect(written.data).toMatchObject({
      eventId: 'fixed-event',
      eventName: 'domain.something.happened',
      aggregateType: 'Something',
      aggregateId: 'agg-1',
      userId: 'user-1',
      payload: { amount: 12, version: 1 },
    });
    expect(typeof written.data.payload.occurredAt).toBe('string');
  });

  it('fills a generated event id and timestamp when the domain fixes none', async () => {
    await outbox.enqueue({
      eventName: 'domain.something.happened',
      aggregateType: 'Something',
      aggregateId: 'agg-1',
      userId: null,
      payload: {},
    });
    const [write] = prisma.domainEventOutbox.create.mock.calls[0] as [
      { data: { eventId: string; payload: Record<string, unknown> } },
    ];
    expect(write.data.eventId).toHaveLength(36);
    expect(write.data.payload).toMatchObject({ version: 1 });
    expect(
      Number.isNaN(Date.parse(String(write.data.payload.occurredAt))),
    ).toBe(false);
  });

  it('reports whether an event id already exists', async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: '1' });
    await expect(outbox.hasEvent('missing')).resolves.toBe(false);
    await expect(outbox.hasEvent('present')).resolves.toBe(true);
    expect(prisma.domainEventOutbox.findUnique).toHaveBeenLastCalledWith({
      where: { eventId: 'present' },
      select: { id: true },
    });
  });
});
