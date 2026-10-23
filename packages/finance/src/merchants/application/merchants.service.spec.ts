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
      aliases: ['UBER *TRIP 1234'],
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
      aliases: ['QA Almuerzo'],
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

describe('MerchantsService.create', () => {
  function createdRow(overrides: Record<string, unknown> = {}) {
    return merchantRow({
      id: 'merchant-new',
      name: 'Supermercado Nacional',
      normalizedKey: 'SUPERMERCADO NACIONAL',
      aliases: ['Nacional'],
      ...overrides,
    });
  }

  it('creates the merchant and answers with the detail shape', async () => {
    const repo = {
      findMerchantByKey: jest.fn(),
      createMerchant: jest.fn().mockResolvedValue(createdRow()),
      findMerchantById: jest.fn().mockResolvedValue(createdRow()),
      sumSpendByMerchant: jest
        .fn()
        .mockResolvedValue([
          { merchantId: 'merchant-new', spend: 0, movements: 0 },
        ]),
    };
    const { service } = build(repo);

    const merchant = await service.create('user-1', {
      name: '  Supermercado Nacional ',
      aliases: ['Nacional'],
    });

    expect(repo.createMerchant).toHaveBeenCalledWith('user-1', {
      name: 'Supermercado Nacional',
      normalizedKey: 'SUPERMERCADO NACIONAL',
      aliases: ['Nacional'],
    });
    expect(merchant).toMatchObject({
      id: 'merchant-new',
      name: 'Supermercado Nacional',
      categoryId: null,
      aliases: ['Nacional'],
      logoUrl: null,
      monthSpend: '0',
      monthMovements: 0,
    });
  });

  it('removes repeated and empty aliases', async () => {
    const repo = {
      createMerchant: jest.fn().mockResolvedValue(createdRow()),
      findMerchantById: jest.fn().mockResolvedValue(createdRow()),
      sumSpendByMerchant: jest.fn().mockResolvedValue([]),
    };
    const { service } = build(repo);

    await service.create('user-1', {
      name: 'Supermercado Nacional',
      aliases: ['Nacional', '  ', 'NACIONAL', 'Súper'],
    });

    expect(repo.createMerchant).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ aliases: ['Nacional', 'Súper'] }),
    );
  });

  it('rejects a name without usable text', async () => {
    const { service } = build();

    await expect(service.create('user-1', { name: '*** 1234' })).rejects.toMatchObject(
      {
        response: {
          message: 'El nombre del comercio no tiene texto utilizable',
        },
      },
    );
  });

  it('rejects a blank name', async () => {
    const { service } = build();

    await expect(service.create('user-1', { name: '   ' })).rejects.toMatchObject({
      response: {
        message: 'El nombre del comercio no tiene texto utilizable',
      },
    });
  });

  it('answers 409 with the merchant that already holds the key', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const repo = {
      createMerchant: jest.fn().mockRejectedValue(duplicate),
      findMerchantByKey: jest.fn().mockResolvedValue(merchantRow()),
    };
    const { service } = build(repo);

    await expect(
      service.create('user-1', { name: 'Uber Eats' }),
    ).rejects.toMatchObject({
      response: {
        message: 'Ya existe un comercio con ese nombre',
        existingMerchantId: 'merchant-1',
      },
    });
  });

  it('rejects a category the user cannot see', async () => {
    const repo = { createMerchant: jest.fn() };
    const { service } = build(repo);
    const ownership = (
      service as unknown as {
        ownership: { assertCategoryVisible: jest.Mock };
      }
    ).ownership;
    ownership.assertCategoryVisible.mockRejectedValue(
      new Error('Categoría no encontrada'),
    );

    await expect(
      service.create('user-1', {
        name: 'Supermercado Nacional',
        categoryId: 'cat-other',
      }),
    ).rejects.toThrow('Categoría no encontrada');
    expect(repo.createMerchant).not.toHaveBeenCalled();
  });
});
