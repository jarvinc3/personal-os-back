import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@personal-os/database';
import { AiSignalsService } from './ai-signals.service';

describe('AiSignalsService', () => {
  it('lists recent signals only for the requesting user with evidence', async () => {
    const prisma = {
      aiSignal: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AiSignalsService(prisma as unknown as PrismaService);
    await service.listForUser('user-a');
    expect(prisma.aiSignal.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-a' },
      include: { evidence: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
  });

  it('does not reveal another user signal', async () => {
    const prisma = {
      aiSignal: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new AiSignalsService(prisma as unknown as PrismaService);
    await expect(service.getForUser('user-a', 'signal-b')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.aiSignal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'signal-b', userId: 'user-a' } }),
    );
  });
});
