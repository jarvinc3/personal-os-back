import type { PrismaService } from '../../../../prisma/prisma.service';
import { EmailSourceRepository } from './email-source.repository';

describe('EmailSourceRepository.listDueGmailSyncSources', () => {
  it('selects due sources only when emailSync.enabled and emailSync.automatic are true', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = new EmailSourceRepository({
      finEmailSource: { findMany },
    } as unknown as PrismaService);
    const cutoff = new Date('2026-09-22T12:00:00.000Z');

    await repo.listDueGmailSyncSources(cutoff);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        connection: { isActive: true },
        institution: { isActive: true },
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lte: cutoff } }],
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
      select: { id: true, userId: true },
    });
  });
});
