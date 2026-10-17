import { Prisma, type PrismaService } from '@personal-os/database';
import {
  EMAIL_PAYLOAD_RETENTION_DAYS,
  EmailMessageRetentionScheduler,
  RETENTION_BATCH_SIZE,
} from './email-message-retention.scheduler';

const DAY_MS = 24 * 60 * 60 * 1000;
const CUTOFF_TOLERANCE_MS = 5_000;

type FinEmailMessageMock = {
  findMany: jest.Mock;
  updateMany: jest.Mock;
};

type Harness = {
  scheduler: EmailMessageRetentionScheduler;
  finEmailMessage: FinEmailMessageMock;
};

type ClearQuery = {
  where: {
    createdAt: { lt: Date };
    extractedPayload: unknown;
  };
  select: { id: boolean };
  orderBy: { createdAt: string };
  take: number;
};

function createHarness(): Harness {
  const finEmailMessage: FinEmailMessageMock = {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const prisma = { finEmailMessage } as unknown as PrismaService;
  return {
    scheduler: new EmailMessageRetentionScheduler(prisma),
    finEmailMessage,
  };
}

function rows(count: number): Array<{ id: string }> {
  const messages: Array<{ id: string }> = [];
  for (let index = 0; index < count; index += 1) {
    messages.push({ id: `message-${index}` });
  }
  return messages;
}

describe('EmailMessageRetentionScheduler', () => {
  it('clears expired payloads in batches until the last batch is partial', async () => {
    const { scheduler, finEmailMessage } = createHarness();
    finEmailMessage.findMany
      .mockResolvedValueOnce(rows(RETENTION_BATCH_SIZE))
      .mockResolvedValueOnce(rows(2));
    finEmailMessage.updateMany
      .mockResolvedValueOnce({ count: RETENTION_BATCH_SIZE })
      .mockResolvedValueOnce({ count: 2 });

    await scheduler.purgeExpiredPayloads();

    expect(finEmailMessage.findMany).toHaveBeenCalledTimes(2);
    expect(finEmailMessage.updateMany).toHaveBeenCalledTimes(2);
    expect(finEmailMessage.updateMany).toHaveBeenLastCalledWith({
      where: { id: { in: ['message-0', 'message-1'] } },
      data: { extractedPayload: Prisma.DbNull },
    });
  });

  it('only looks at rows older than the retention window and takes a bounded batch', async () => {
    const { scheduler, finEmailMessage } = createHarness();

    await scheduler.purgeExpiredPayloads();

    const [query] = finEmailMessage.findMany.mock.calls[0] as [ClearQuery];
    const cutoff = query.where.createdAt.lt;
    const expected = Date.now() - EMAIL_PAYLOAD_RETENTION_DAYS * DAY_MS;
    expect(cutoff).toBeInstanceOf(Date);
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(
      CUTOFF_TOLERANCE_MS,
    );
    expect(query.where.extractedPayload).toEqual({ not: Prisma.DbNull });
    expect(query.select).toEqual({ id: true });
    expect(query.take).toBe(RETENTION_BATCH_SIZE);
  });

  it('sets the payload to SQL NULL', async () => {
    const { scheduler, finEmailMessage } = createHarness();
    finEmailMessage.findMany.mockResolvedValueOnce(rows(1));

    await scheduler.purgeExpiredPayloads();

    expect(finEmailMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['message-0'] } },
      data: { extractedPayload: Prisma.DbNull },
    });
  });

  it('does not update anything when no payload is expired', async () => {
    const { scheduler, finEmailMessage } = createHarness();

    await scheduler.purgeExpiredPayloads();

    expect(finEmailMessage.updateMany).not.toHaveBeenCalled();
  });

  it('keeps going after a full batch cleared by another instance, then stops', async () => {
    const { scheduler, finEmailMessage } = createHarness();
    finEmailMessage.findMany
      .mockResolvedValueOnce(rows(RETENTION_BATCH_SIZE))
      .mockResolvedValueOnce([]);

    await scheduler.purgeExpiredPayloads();

    expect(finEmailMessage.findMany).toHaveBeenCalledTimes(2);
    expect(finEmailMessage.updateMany).toHaveBeenCalledTimes(1);
  });
});
