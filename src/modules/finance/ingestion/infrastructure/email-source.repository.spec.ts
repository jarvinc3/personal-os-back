import type { PrismaService } from '../../../../prisma/prisma.service';
import { EmailSourceRepository } from './email-source.repository';

describe('EmailSourceRepository.listAutoSyncSources', () => {
  it('selects active sources with emailSync.enabled and emailSync.automatic true', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = new EmailSourceRepository({
      finEmailSource: { findMany },
    } as unknown as PrismaService);

    await repo.listAutoSyncSources();

    expect(findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        connection: { isActive: true },
        institution: { isActive: true },
        user: {
          userModules: {
            some: {
              isEnabled: true,
              module: { slug: 'finance' },
              AND: [
                {
                  config: {
                    path: ['emailSync', 'enabled'],
                    equals: true,
                  },
                },
                {
                  config: {
                    path: ['emailSync', 'automatic'],
                    equals: true,
                  },
                },
              ],
            },
          },
        },
      },
      select: {
        id: true,
        userId: true,
        lastSyncedAt: true,
        user: {
          select: {
            timezone: true,
            userModules: {
              where: { module: { slug: 'finance' } },
              select: { config: true },
              take: 1,
            },
          },
        },
      },
    });
  });
});

describe('EmailSourceRepository.listRecentEmailMessages', () => {
  it('loads recent extracts for the user newest first', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = new EmailSourceRepository({
      finEmailMessage: { findMany },
    } as unknown as PrismaService);

    await repo.listRecentEmailMessages('user-1', 40);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: { userId: 'user-1' } },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
    );
  });
});
