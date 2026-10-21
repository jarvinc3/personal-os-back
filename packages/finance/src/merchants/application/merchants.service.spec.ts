import { Prisma } from '@personal-os/database';
import { MerchantsService } from './merchants.service';
import type { MerchantsRepository } from '../infrastructure/merchants.repository';

type Mocked = jest.Mocked<Pick<MerchantsRepository, keyof MerchantsRepository>>;

function merchantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'merchant-1',
    userId: 'user-1',
    name: 'Uber',
    normalizedKey: 'UBER',
    aliases: ['UBER *TRIP 1234'],
    categoryId: null,
    logoUrl: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function build(repo: Partial<Mocked> = {}) {
  const fullRepo = {
    findMerchantByKey: jest.fn(),
    findMerchantByKeyPrefix: jest.fn(),
    createMerchant: jest.fn(),
    updateMerchant: jest.fn(),
    findMerchantById: jest.fn(),
    listMerchants: jest.fn().mockResolvedValue([]),
    sumSpendByMerchant: jest.fn().mockResolvedValue([]),
    ...repo,
  } as unknown as MerchantsRepository;
  const ownership = { assertCategoryVisible: jest.fn() };
  const logos = { saveCustomLogo: jest.fn(), publicUrl: jest.fn() };
  return {
    service: new MerchantsService(fullRepo, ownership as never, logos as never),
    repo: fullRepo as unknown as Mocked,
  };
}

describe('MerchantsService.resolve', () => {
  it('groups a new raw descriptor under one canonical merchant', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(null),
      createMerchant: jest.fn().mockResolvedValue(merchantRow()),
    };
    const { service } = build(repo);

    const resolved = await service.resolve('user-1', 'UBER *TRIP 1234');

    expect(repo.createMerchant).toHaveBeenCalledWith('user-1', {
      name: 'Uber',
      normalizedKey: 'UBER',
      rawAlias: 'UBER *TRIP 1234',
    });
    expect(resolved).toEqual({
      id: 'merchant-1',
      name: 'Uber',
      normalizedKey: 'UBER',
      categoryId: null,
    });
  });

  it('keeps the typed capitalisation as the visible name', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(null),
      createMerchant: jest
        .fn()
        .mockResolvedValue(
          merchantRow({ name: 'QA Almuerzo', normalizedKey: 'QA ALMUERZO' }),
        ),
    };
    const { service } = build(repo);

    await service.resolveTyped('user-1', 'QA Almuerzo');

    expect(repo.createMerchant).toHaveBeenCalledWith('user-1', {
      name: 'QA Almuerzo',
      normalizedKey: 'QA ALMUERZO',
      rawAlias: 'QA Almuerzo',
    });
  });

  it('reuses a known merchant and keeps the new text as alias', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(merchantRow()),
      updateMerchant: jest.fn().mockResolvedValue({ count: 1 }),
      createMerchant: jest.fn(),
    };
    const { service } = build(repo);

    await service.resolve('user-1', 'Uber Eats');

    expect(repo.createMerchant).not.toHaveBeenCalled();
    expect(repo.updateMerchant).toHaveBeenCalledWith('user-1', 'merchant-1', {
      aliases: ['UBER *TRIP 1234', 'Uber Eats'],
    });
  });

  it('returns null when the text has no usable key', async () => {
    const { service } = build();
    await expect(service.resolve('user-1', '1234')).resolves.toBeNull();
  });
});

describe('MerchantsService.suggest', () => {
  it('prefers an exact key match', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(merchantRow()),
      findMerchantByKeyPrefix: jest.fn(),
    };
    const { service } = build(repo);

    const suggestion = await service.suggest('user-1', 'UBER TRIP');

    expect(suggestion).toEqual({
      merchantId: 'merchant-1',
      name: 'Uber',
      categoryId: null,
    });
    expect(repo.findMerchantByKeyPrefix).not.toHaveBeenCalled();
  });

  it('falls back to a prefix match', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(null),
      findMerchantByKeyPrefix: jest
        .fn()
        .mockResolvedValue(merchantRow({ categoryId: 'cat-1' })),
    };
    const { service } = build(repo);

    const suggestion = await service.suggest('user-1', 'UBER');

    expect(repo.findMerchantByKeyPrefix).toHaveBeenCalledWith('user-1', 'UBER');
    expect(suggestion?.categoryId).toBe('cat-1');
  });

  it('returns null when nothing matches', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(null),
      findMerchantByKeyPrefix: jest.fn().mockResolvedValue(null),
    };
    const { service } = build(repo);

    await expect(service.suggest('user-1', 'DESCONOCIDO')).resolves.toBeNull();
  });
});

describe('MerchantsService.get', () => {
  it('sums the current month through the end of its last day', async () => {
    const { service, repo } = build({
      findMerchantById: jest.fn().mockResolvedValue(merchantRow()),
      sumSpendByMerchant: jest.fn().mockResolvedValue([
        {
          merchantId: 'merchant-1',
          spend: new Prisma.Decimal(500),
          movements: 2,
        },
      ]),
    });

    const merchant = await service.get(
      'user-1',
      'merchant-1',
      new Date(Date.UTC(2026, 9, 14)),
    );

    expect(repo.sumSpendByMerchant).toHaveBeenCalledWith(
      'user-1',
      ['merchant-1'],
      {
        from: new Date(Date.UTC(2026, 9, 1)),
        to: new Date(Date.UTC(2026, 9, 31, 23, 59, 59)),
      },
    );
    expect(merchant.monthSpend).toBe('500');
    expect(merchant.monthMovements).toBe(2);
  });

  it('keeps the exact sum of a large spend', async () => {
    const { service } = build({
      findMerchantById: jest.fn().mockResolvedValue(merchantRow()),
      sumSpendByMerchant: jest.fn().mockResolvedValue([
        {
          merchantId: 'merchant-1',
          spend: new Prisma.Decimal('9007199254740993.01'),
          movements: 2,
        },
      ]),
    });

    const merchant = await service.get('user-1', 'merchant-1');

    expect(merchant.monthSpend).toBe('9007199254740993.01');
  });
});

describe('MerchantsService.list', () => {
  it('covers the whole last day of an explicit window', async () => {
    const { service, repo } = build();

    await service.list(
      'user-1',
      { limit: 20, dateFrom: '2026-10-01', dateTo: '2026-10-31' },
      new Date(Date.UTC(2026, 9, 14)),
    );

    expect(repo.sumSpendByMerchant).toHaveBeenCalledWith('user-1', [], {
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-31T23:59:59.999Z'),
    });
  });
});
