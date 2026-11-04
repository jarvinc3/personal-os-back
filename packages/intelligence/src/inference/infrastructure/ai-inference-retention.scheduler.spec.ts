import type { PrismaService } from '@personal-os/database';
import { AiInferenceRetentionScheduler } from './ai-inference-retention.scheduler';

describe('AiInferenceRetentionScheduler', () => {
  it('deletes rows expired at the scheduled cutoff', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'row-1' }, { id: 'row-2' }])
      .mockResolvedValueOnce([]);
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const scheduler = new AiInferenceRetentionScheduler({
      aiInference: { findMany, deleteMany },
    } as unknown as PrismaService);
    const now = new Date('2026-10-24T03:00:00.000Z');

    await expect(scheduler.purgeExpired(now)).resolves.toBe(2);
    expect(findMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
      select: { id: true },
      take: 1_000,
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['row-1', 'row-2'] } },
    });
  });
});
