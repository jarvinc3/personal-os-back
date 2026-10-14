import { RecurringRepository } from './recurring.repository';
import type { PrismaService } from '@personal-os/database';

describe('RecurringRepository listPatterns', () => {
  it('walks forward from the cursor because the list is ascending', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      finRecurringPattern: { findMany },
    } as unknown as PrismaService;
    const repo = new RecurringRepository(prisma);
    const cursor = { key: '2026-04-01T00:00:00.000Z', id: 'pattern-1' };

    await repo.listPatterns('user-1', { cursor, take: 21 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { nextExpectedDate: { gt: new Date(cursor.key) } },
            { nextExpectedDate: new Date(cursor.key), id: { gt: cursor.id } },
          ],
        }),
        orderBy: [{ nextExpectedDate: 'asc' }, { id: 'asc' }],
      }),
    );
  });
});
