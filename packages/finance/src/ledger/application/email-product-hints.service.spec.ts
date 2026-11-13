import type { PrismaService } from '@personal-os/database';
import { FinanceEmailProductHints } from './email-product-hints.service';

function service(
  cards: { lastFour: string | null }[],
  accounts: { accountNumberLast4: string | null }[],
) {
  const prisma = {
    finCard: { findMany: jest.fn().mockResolvedValue(cards) },
    finAccount: { findMany: jest.fn().mockResolvedValue(accounts) },
  };
  return {
    subject: new FinanceEmailProductHints(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('FinanceEmailProductHints', () => {
  it('returns the last four of the active cards and accounts of the owner', async () => {
    const { subject, prisma } = service(
      [{ lastFour: '6506' }],
      [{ accountNumberLast4: '0016' }, { accountNumberLast4: '0024' }],
    );

    await expect(subject.readEmailProductHints('user-1')).resolves.toEqual({
      cardLast4: ['6506'],
      accountLast4: ['0016', '0024'],
    });
    expect(prisma.finCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', isActive: true, lastFour: { not: null } },
      }),
    );
    expect(prisma.finAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          isActive: true,
          accountNumberLast4: { not: null },
        },
      }),
    );
  });

  it('returns empty lists when the owner has no products yet', async () => {
    const { subject } = service([], []);

    await expect(subject.readEmailProductHints('user-1')).resolves.toEqual({
      cardLast4: [],
      accountLast4: [],
    });
  });
});
