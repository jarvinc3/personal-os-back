import { CatalogRepository } from './catalog.repository';
import type { PrismaService } from '@personal-os/database';

describe('CatalogRepository createAccount', () => {
  it('always persists institutionId and omits empty color', async () => {
    const created = {
      id: 'acc-1',
      userId: 'user-1',
      name: 'QA Cuenta',
      type: 'SAVINGS',
      currency: 'DOP',
      balance: 0,
      institutionId: 'inst-1',
      color: null,
      isActive: true,
      institutionRef: { name: 'Banco' },
    };
    const create = jest.fn().mockResolvedValue(created);
    const prisma = {
      finAccount: { create },
    } as unknown as PrismaService;

    const repo = new CatalogRepository(prisma, {} as never);
    await repo.createAccount('user-1', {
      name: 'QA Cuenta',
      type: 'SAVINGS',
      institutionId: 'inst-1',
      accountNumber: 'encrypted-number',
      accountNumberLast4: '5678',
      accountNumberHash: 'fingerprint-hash',
    });

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data).toEqual({
      userId: 'user-1',
      name: 'QA Cuenta',
      type: 'SAVINGS',
      currency: 'DOP',
      balance: 0,
      institutionId: 'inst-1',
      accountNumber: 'encrypted-number',
      accountNumberLast4: '5678',
      accountNumberHash: 'fingerprint-hash',
      isDefaultForInstitution: false,
    });
    expect(Object.keys(data)).not.toContain('institution');
    expect(Object.keys(data)).not.toContain('color');
  });

  it('includes color when provided', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'acc-2' });
    const prisma = {
      finAccount: { create },
    } as unknown as PrismaService;

    const repo = new CatalogRepository(prisma, {} as never);
    await repo.createAccount('user-1', {
      name: 'Nómina',
      type: 'CHECKING',
      currency: 'usd',
      institutionId: 'inst-1',
      color: '#22c55e',
      accountNumber: 'encrypted-number',
      accountNumberLast4: '5678',
      accountNumberHash: 'fingerprint-hash',
    });

    const data = create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data).toEqual({
      userId: 'user-1',
      name: 'Nómina',
      type: 'CHECKING',
      currency: 'usd',
      balance: 0,
      institutionId: 'inst-1',
      accountNumber: 'encrypted-number',
      accountNumberLast4: '5678',
      accountNumberHash: 'fingerprint-hash',
      isDefaultForInstitution: false,
      color: '#22c55e',
    });
  });
});

describe('CatalogRepository ensureCashAccount', () => {
  const input = {
    institutionId: 'cash-1',
    name: 'Efectivo',
    currency: 'DOP',
  };

  function buildRepo(existingCashAccount: { id: string } | null) {
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'cash-1' }]);
    const findFirst = jest.fn().mockResolvedValue(existingCashAccount);
    const create = jest.fn().mockResolvedValue({ id: 'cash-acc-1' });
    const tx = { $queryRaw: queryRaw, finAccount: { findFirst, create } };
    const transaction = jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    return {
      repo: new CatalogRepository(prisma, {} as never),
      queryRaw,
      findFirst,
      create,
    };
  }

  it('locks the institution and does not create a second cash account', async () => {
    const { repo, queryRaw, findFirst, create } = buildRepo({
      id: 'cash-acc-1',
    });

    await repo.ensureCashAccount('user-1', input);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', type: 'CASH' },
      select: { id: true },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates the cash account when the locked check finds none', async () => {
    const { repo, create } = buildRepo(null);

    await repo.ensureCashAccount('user-1', input);

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        institutionId: 'cash-1',
        name: 'Efectivo',
        type: 'CASH',
        currency: 'DOP',
      },
    });
  });
});

describe('CatalogRepository email product candidates', () => {
  it('only counts active accounts as existing for a proposal', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      finAccount: { findMany },
    } as unknown as PrismaService;

    const repo = new CatalogRepository(prisma, {} as never);
    await repo.findEmailAccountCandidates('user-1', '0016');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          accountNumberLast4: '0016',
          isActive: true,
        },
      }),
    );
  });

  it('only counts active cards as existing for a proposal', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      finCard: { findMany },
    } as unknown as PrismaService;

    const repo = new CatalogRepository(prisma, {} as never);
    await repo.findEmailCardCandidates('user-1', '6506');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', lastFour: '6506', isActive: true },
      }),
    );
  });
});

describe('CatalogRepository batch email candidates', () => {
  it('reads active accounts for every suffix in one query', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      finAccount: { findMany },
    } as unknown as PrismaService;

    const repo = new CatalogRepository(prisma, {} as never);
    await repo.findEmailAccountCandidatesByLastFours('user-1', [
      '0016',
      '6506',
    ]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          accountNumberLast4: { in: ['0016', '6506'] },
          isActive: true,
        },
      }),
    );
  });

  it('reads active cards for every suffix in one query', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      finCard: { findMany },
    } as unknown as PrismaService;

    const repo = new CatalogRepository(prisma, {} as never);
    await repo.findEmailCardCandidatesByLastFours('user-1', ['6506']);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          lastFour: { in: ['6506'] },
          isActive: true,
        },
      }),
    );
  });
});
