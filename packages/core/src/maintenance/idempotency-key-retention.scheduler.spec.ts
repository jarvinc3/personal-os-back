import { type PrismaService } from '@personal-os/database';
import {
  IdempotencyKeyRetentionScheduler,
  PURGE_BATCH_SIZE,
} from './idempotency-key-retention.scheduler';

type IdempotencyKeyMock = {
  findMany: jest.Mock;
  deleteMany: jest.Mock;
};

type Harness = {
  scheduler: IdempotencyKeyRetentionScheduler;
  idempotencyKey: IdempotencyKeyMock;
};

type PurgeQuery = {
  where: { expiresAt: { lt: unknown } };
  select: { id: boolean };
  take: number;
};

function createHarness(): Harness {
  const idempotencyKey: IdempotencyKeyMock = {
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const prisma = { idempotencyKey } as unknown as PrismaService;
  return {
    scheduler: new IdempotencyKeyRetentionScheduler(prisma),
    idempotencyKey,
  };
}

function rows(count: number): Array<{ id: string }> {
  const keys: Array<{ id: string }> = [];
  for (let index = 0; index < count; index += 1) {
    keys.push({ id: `key-${index}` });
  }
  return keys;
}

describe('IdempotencyKeyRetentionScheduler', () => {
  it('deletes expired keys in batches until the last batch is partial', async () => {
    const { scheduler, idempotencyKey } = createHarness();
    idempotencyKey.findMany
      .mockResolvedValueOnce(rows(PURGE_BATCH_SIZE))
      .mockResolvedValueOnce(rows(2));
    idempotencyKey.deleteMany
      .mockResolvedValueOnce({ count: PURGE_BATCH_SIZE })
      .mockResolvedValueOnce({ count: 2 });

    await scheduler.purgeExpired();

    expect(idempotencyKey.findMany).toHaveBeenCalledTimes(2);
    expect(idempotencyKey.deleteMany).toHaveBeenCalledTimes(2);
    expect(idempotencyKey.deleteMany).toHaveBeenLastCalledWith({
      where: { id: { in: ['key-0', 'key-1'] } },
    });
  });

  it('only looks at keys expired before the run and takes a bounded batch', async () => {
    const { scheduler, idempotencyKey } = createHarness();

    await scheduler.purgeExpired();

    const [query] = idempotencyKey.findMany.mock.calls[0] as [PurgeQuery];
    expect(query.where.expiresAt.lt).toBeInstanceOf(Date);
    expect(query.select).toEqual({ id: true });
    expect(query.take).toBe(PURGE_BATCH_SIZE);
  });

  it('does not delete anything when no key is expired', async () => {
    const { scheduler, idempotencyKey } = createHarness();

    await scheduler.purgeExpired();

    expect(idempotencyKey.deleteMany).not.toHaveBeenCalled();
  });

  it('stops when a full batch was already deleted by another instance', async () => {
    const { scheduler, idempotencyKey } = createHarness();
    idempotencyKey.findMany.mockResolvedValue(rows(PURGE_BATCH_SIZE));
    idempotencyKey.deleteMany.mockResolvedValue({ count: 0 });

    await scheduler.purgeExpired();

    expect(idempotencyKey.findMany).toHaveBeenCalledTimes(1);
  });
});
