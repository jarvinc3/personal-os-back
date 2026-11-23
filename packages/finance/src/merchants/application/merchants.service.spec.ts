import { ServiceUnavailableException } from '@nestjs/common';
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
    aliases: [{ alias: 'UBER *TRIP 1234' }],
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
    listVisibleCategories: jest.fn().mockResolvedValue([]),
    findMerchantByAliasKey: jest.fn().mockResolvedValue(null),
    findMerchantByAliasKeys: jest.fn().mockResolvedValue(null),
    findMerchantByKeys: jest.fn().mockResolvedValue(null),
    addAlias: jest.fn().mockResolvedValue(undefined),
    replaceAliases: jest.fn().mockResolvedValue(undefined),
    findMerchantsByIds: jest.fn().mockResolvedValue([]),
    listMerchantComparables: jest.fn().mockResolvedValue([]),
    listDismissedPairs: jest.fn().mockResolvedValue([]),
    ...repo,
  } as unknown as MerchantsRepository;
  const ownership = { assertCategoryVisible: jest.fn() };
  const logos = {
    saveCustomLogo: jest.fn(),
    publicUrl: jest.fn(),
    ensureLogo: jest.fn().mockResolvedValue(null),
    deleteCustomLogo: jest.fn().mockResolvedValue(undefined),
    resolveUrl: jest.fn().mockReturnValue(null),
  };
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

    const resolved = await service.resolve({
      userId: 'user-1',
      rawName: 'UBER *TRIP 1234',
    });

    expect(repo.createMerchant).toHaveBeenCalledWith('user-1', {
      name: 'Uber',
      normalizedKey: 'UBER',
      aliases: ['UBER *TRIP 1234'],
      categoryId: null,
      categorySource: null,
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

    await service.resolveTyped({ userId: 'user-1', rawName: 'QA Almuerzo' });

    expect(repo.createMerchant).toHaveBeenCalledWith('user-1', {
      name: 'QA Almuerzo',
      normalizedKey: 'QA ALMUERZO',
      aliases: ['QA Almuerzo'],
      categoryId: null,
      categorySource: null,
    });
  });

  it('reuses a known merchant and keeps a new text as alias', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(merchantRow()),
      createMerchant: jest.fn(),
      addAlias: jest.fn().mockResolvedValue(undefined),
    };
    const { service } = build(repo);

    await service.resolve({ userId: 'user-1', rawName: 'Uber Viaje 9' });

    expect(repo.createMerchant).not.toHaveBeenCalled();
    expect(repo.addAlias).toHaveBeenCalledWith({
      userId: 'user-1',
      merchantId: 'merchant-1',
      alias: 'Uber Viaje 9',
      normalizedKey: 'UBER VIAJE 9',
    });
  });

  it('does not store a text that normalizes to the same key', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(merchantRow()),
      createMerchant: jest.fn(),
      addAlias: jest.fn(),
    };
    const { service } = build(repo);

    await service.resolve({ userId: 'user-1', rawName: 'Uber Eats' });

    expect(repo.addAlias).not.toHaveBeenCalled();
  });

  it('recognizes a merchant by one of its aliases', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(null),
      findMerchantByAliasKey: jest
        .fn()
        .mockResolvedValue(
          merchantRow({ aliases: [{ alias: 'Supermercado Nacional' }] }),
        ),
      createMerchant: jest.fn(),
      addAlias: jest.fn(),
    };
    const { service } = build(repo);

    const resolved = await service.resolve({
      userId: 'user-1',
      rawName: 'Supermercado Nacional',
    });

    expect(repo.findMerchantByAliasKey).toHaveBeenCalledWith(
      'user-1',
      'SUPERMERCADO NACIONAL',
    );
    expect(resolved?.id).toBe('merchant-1');
    expect(repo.createMerchant).not.toHaveBeenCalled();
  });

  it('stops growing the alias list at the maximum', async () => {
    const full = merchantRow({
      aliases: Array.from({ length: 20 }, (_, index) => ({
        alias: `Alias ${index}`,
      })),
    });
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(full),
      createMerchant: jest.fn(),
      addAlias: jest.fn(),
    };
    const { service } = build(repo);

    await service.resolve({ userId: 'user-1', rawName: 'Uber Nuevo' });

    expect(repo.addAlias).not.toHaveBeenCalled();
  });

  it('returns null when the text has no usable key', async () => {
    const { service } = build();
    await expect(
      service.resolve({ userId: 'user-1', rawName: '1234' }),
    ).resolves.toBeNull();
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
      categorySource: null,
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
      aliases: [{ alias: 'Nacional' }],
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
      categoryId: null,
      categorySource: null,
      domain: null,
      logoPath: null,
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

    await expect(
      service.create('user-1', { name: '*** 1234' }),
    ).rejects.toMatchObject({
      response: {
        message: 'El nombre del comercio no tiene texto utilizable',
      },
    });
  });

  it('rejects a blank name', async () => {
    const { service } = build();

    await expect(
      service.create('user-1', { name: '   ' }),
    ).rejects.toMatchObject({
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

describe('MerchantsService category learning', () => {
  it('learns the category of a new merchant from its first movement', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(null),
      createMerchant: jest
        .fn()
        .mockResolvedValue(
          merchantRow({ categoryId: 'cat-food', categorySource: 'LEARNED' }),
        ),
    };
    const { service } = build(repo);

    const resolved = await service.resolve({
      userId: 'user-1',
      rawName: 'Supermercado Nacional',
      categoryId: 'cat-food',
      transactionType: 'DEBIT',
    });

    expect(repo.createMerchant).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        categoryId: 'cat-food',
        categorySource: 'LEARNED',
      }),
    );
    expect(resolved?.categoryId).toBe('cat-food');
  });

  it('adopts the movement category when the merchant has none', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(merchantRow()),
      updateMerchant: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const { service } = build(repo);

    await service.resolve({
      userId: 'user-1',
      rawName: 'Uber',
      categoryId: 'cat-transport',
      transactionType: 'DEBIT',
    });

    expect(repo.updateMerchant).toHaveBeenCalledWith('user-1', 'merchant-1', {
      categoryId: 'cat-transport',
      categorySource: 'LEARNED',
    });
  });

  it('replaces a keyword guess with the movement category', async () => {
    const repo = {
      findMerchantByKey: jest
        .fn()
        .mockResolvedValue(
          merchantRow({ categoryId: 'cat-guess', categorySource: 'KEYWORD' }),
        ),
      updateMerchant: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const { service } = build(repo);

    await service.resolve({
      userId: 'user-1',
      rawName: 'Uber',
      categoryId: 'cat-transport',
      transactionType: 'DEBIT',
    });

    expect(repo.updateMerchant).toHaveBeenCalledWith('user-1', 'merchant-1', {
      categoryId: 'cat-transport',
      categorySource: 'LEARNED',
    });
  });

  it('never overwrites a category set by hand', async () => {
    const repo = {
      findMerchantByKey: jest
        .fn()
        .mockResolvedValue(
          merchantRow({ categoryId: 'cat-manual', categorySource: 'MANUAL' }),
        ),
      updateMerchant: jest.fn(),
    };
    const { service } = build(repo);

    await service.resolve({
      userId: 'user-1',
      rawName: 'Uber',
      categoryId: 'cat-transport',
      transactionType: 'DEBIT',
    });

    expect(repo.updateMerchant).not.toHaveBeenCalledWith(
      'user-1',
      'merchant-1',
      expect.objectContaining({ categoryId: expect.anything() }),
    );
  });

  it('guesses a category by keyword when there is no history', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(null),
      listVisibleCategories: jest
        .fn()
        .mockResolvedValue([
          { id: 'cat-food', name: 'Supermercado', type: 'EXPENSE' },
        ]),
      createMerchant: jest.fn().mockResolvedValue(
        merchantRow({
          name: 'Supermercado Nacional',
          normalizedKey: 'SUPERMERCADO NACIONAL',
          categoryId: 'cat-food',
          categorySource: 'KEYWORD',
        }),
      ),
    };
    const { service } = build(repo);

    await service.resolve({
      userId: 'user-1',
      rawName: 'Supermercado Nacional',
      transactionType: 'DEBIT',
    });

    expect(repo.createMerchant).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        categoryId: 'cat-food',
        categorySource: 'KEYWORD',
      }),
    );
  });

  it('leaves an ambiguous merchant without a category', async () => {
    const repo = {
      findMerchantByKey: jest.fn().mockResolvedValue(null),
      listVisibleCategories: jest
        .fn()
        .mockResolvedValue([
          { id: 'cat-food', name: 'Supermercado', type: 'EXPENSE' },
        ]),
      createMerchant: jest
        .fn()
        .mockResolvedValue(merchantRow({ name: 'Google' })),
    };
    const { service } = build(repo);

    await service.resolve({
      userId: 'user-1',
      rawName: 'Google',
      transactionType: 'DEBIT',
    });

    expect(repo.createMerchant).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ categoryId: null, categorySource: null }),
    );
  });

  it('marks a category confirmed by the user as manual', async () => {
    const repo = {
      findMerchantById: jest
        .fn()
        .mockResolvedValue(
          merchantRow({ categoryId: 'cat-food', categorySource: 'KEYWORD' }),
        ),
      updateMerchant: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const { service } = build(repo);

    await service.update('user-1', 'merchant-1', { categoryId: 'cat-food' });

    expect(repo.updateMerchant).toHaveBeenCalledWith('user-1', 'merchant-1', {
      categoryId: 'cat-food',
      categorySource: 'MANUAL',
    });
  });

  it('suggests the category with its origin', async () => {
    const repo = {
      findMerchantByKey: jest
        .fn()
        .mockResolvedValue(
          merchantRow({ categoryId: 'cat-food', categorySource: 'LEARNED' }),
        ),
    };
    const { service } = build(repo);

    await expect(service.suggest('user-1', 'Uber')).resolves.toEqual({
      merchantId: 'merchant-1',
      name: 'Uber',
      categoryId: 'cat-food',
      categorySource: 'LEARNED',
    });
  });
});

describe('MerchantsService aliases', () => {
  it('replaces the whole alias list on PATCH', async () => {
    const repo = {
      findMerchantById: jest
        .fn()
        .mockResolvedValue(merchantRow({ aliases: [{ alias: 'Viejo' }] })),
      replaceAliases: jest.fn().mockResolvedValue(undefined),
    };
    const { service } = build(repo);

    await service.update('user-1', 'merchant-1', {
      aliases: ['Nacional', 'NACIONAL', '  ', 'Súper'],
    });

    expect(repo.replaceAliases).toHaveBeenCalledWith('user-1', 'merchant-1', [
      'Nacional',
      'Súper',
    ]);
  });

  it('rejects an alias that is another merchant key', async () => {
    const repo = {
      findMerchantById: jest.fn().mockResolvedValue(merchantRow()),
      findMerchantByKeys: jest
        .fn()
        .mockResolvedValue(merchantRow({ id: 'merchant-2' })),
      findMerchantByAliasKeys: jest.fn().mockResolvedValue(null),
      replaceAliases: jest.fn(),
    };
    const { service } = build(repo);

    await expect(
      service.update('user-1', 'merchant-1', { aliases: ['Nacional'] }),
    ).rejects.toMatchObject({
      response: {
        message: 'Ya existe un comercio con ese nombre',
        existingMerchantId: 'merchant-2',
      },
    });
    expect(repo.replaceAliases).not.toHaveBeenCalled();
  });

  it('rejects an alias that another merchant already has', async () => {
    const repo = {
      findMerchantById: jest.fn().mockResolvedValue(merchantRow()),
      findMerchantByKeys: jest.fn().mockResolvedValue(null),
      findMerchantByAliasKeys: jest
        .fn()
        .mockResolvedValue(merchantRow({ id: 'merchant-3' })),
      replaceAliases: jest.fn(),
    };
    const { service } = build(repo);

    await expect(
      service.update('user-1', 'merchant-1', { aliases: ['Nacional'] }),
    ).rejects.toMatchObject({
      response: { existingMerchantId: 'merchant-3' },
    });
  });

  it('keeps the previous name as an alias when the merchant is renamed', async () => {
    const repo = {
      findMerchantById: jest
        .fn()
        .mockResolvedValue(
          merchantRow({ name: 'Supermercado Nacional', aliases: [] }),
        ),
      updateMerchant: jest.fn().mockResolvedValue({ count: 1 }),
      addAlias: jest.fn().mockResolvedValue(undefined),
    };
    const { service } = build(repo);

    await service.update('user-1', 'merchant-1', { name: 'Nacional Express' });

    expect(repo.addAlias).toHaveBeenCalledWith({
      userId: 'user-1',
      merchantId: 'merchant-1',
      alias: 'Supermercado Nacional',
      normalizedKey: 'SUPERMERCADO NACIONAL',
    });
  });
});

describe('MerchantsService duplicates', () => {
  it('returns candidates with their reason and month data', async () => {
    const repo = {
      findMerchantById: jest
        .fn()
        .mockResolvedValue(merchantRow({ name: 'Supermercado Nacional' })),
      listMerchantComparables: jest.fn().mockResolvedValue([
        {
          id: 'merchant-1',
          name: 'Supermercado Nacional',
          normalizedKey: 'SUPERMERCADO NACIONAL',
          logoUrl: null,
          aliases: [],
        },
        {
          id: 'merchant-2',
          name: 'Supermercado Nacional 5',
          normalizedKey: 'SUPERMERCADO NACIONAL 5',
          logoUrl: null,
          aliases: [],
        },
        {
          id: 'merchant-3',
          name: 'Farmacia Carol',
          normalizedKey: 'FARMACIA CAROL',
          logoUrl: null,
          aliases: [],
        },
      ]),
      sumSpendByMerchant: jest
        .fn()
        .mockResolvedValue([
          { merchantId: 'merchant-2', spend: 250, movements: 3 },
        ]),
    };
    const { service } = build(repo);

    const candidates = await service.duplicates('user-1', 'merchant-1');

    expect(candidates).toEqual([
      {
        id: 'merchant-2',
        name: 'Supermercado Nacional 5',
        logoUrl: null,
        monthSpend: '250',
        monthMovements: 3,
        reason: 'TRAILING_NUMBER',
      },
    ]);
  });

  it('returns an empty list when nothing looks the same', async () => {
    const repo = {
      findMerchantById: jest.fn().mockResolvedValue(merchantRow()),
      listMerchantComparables: jest.fn().mockResolvedValue([
        {
          id: 'merchant-1',
          name: 'Uber',
          normalizedKey: 'UBER',
          logoUrl: null,
          aliases: [],
        },
      ]),
      sumSpendByMerchant: jest.fn().mockResolvedValue([]),
    };
    const { service } = build(repo);

    await expect(service.duplicates('user-1', 'merchant-1')).resolves.toEqual(
      [],
    );
  });

  it('flags the count on each list item', async () => {
    const repo = {
      listMerchants: jest.fn().mockResolvedValue([
        merchantRow({
          id: 'merchant-1',
          name: 'Supermercado Nacional',
          aliases: [],
        }),
        merchantRow({
          id: 'merchant-2',
          name: 'Supermercado Nacional 5',
          normalizedKey: 'SUPERMERCADO NACIONAL 5',
          aliases: [],
        }),
      ]),
      sumSpendByMerchant: jest.fn().mockResolvedValue([]),
      listMerchantComparables: jest.fn().mockResolvedValue([
        {
          id: 'merchant-1',
          name: 'Supermercado Nacional',
          normalizedKey: 'SUPERMERCADO NACIONAL',
          logoUrl: null,
          aliases: [],
        },
        {
          id: 'merchant-2',
          name: 'Supermercado Nacional 5',
          normalizedKey: 'SUPERMERCADO NACIONAL 5',
          logoUrl: null,
          aliases: [],
        },
      ]),
    };
    const { service } = build(repo);

    const page = await service.list('user-1', {} as never);

    expect(page.items.map((item) => item.possibleDuplicates)).toEqual([1, 1]);
  });
});

describe('MerchantsService dismissed pairs', () => {
  function pairRepo() {
    return {
      findMerchantById: jest
        .fn()
        .mockImplementation((_userId, id) =>
          Promise.resolve(
            id === 'merchant-missing' ? null : merchantRow({ id }),
          ),
        ),
      dismissPair: jest.fn().mockResolvedValue({ id: 'dismissal-1' }),
      undoDismissPair: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('stores the pair in canonical order', async () => {
    const repo = pairRepo();
    const { service } = build(repo);

    await service.dismissDuplicate('user-1', 'merchant-b', 'merchant-a');

    expect(repo.dismissPair).toHaveBeenCalledWith(
      'user-1',
      'merchant-a',
      'merchant-b',
    );
  });

  it('is idempotent: repeating the dismissal stores the same pair', async () => {
    const repo = pairRepo();
    const { service } = build(repo);

    await service.dismissDuplicate('user-1', 'merchant-a', 'merchant-b');
    await service.dismissDuplicate('user-1', 'merchant-b', 'merchant-a');

    expect(repo.dismissPair).toHaveBeenCalledTimes(2);
    expect(repo.dismissPair).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'merchant-a',
      'merchant-b',
    );
  });

  it('rejects a merchant with itself', async () => {
    const repo = pairRepo();
    const { service } = build(repo);

    await expect(
      service.dismissDuplicate('user-1', 'merchant-a', 'merchant-a'),
    ).rejects.toMatchObject({
      response: {
        message: 'No se puede descartar un comercio consigo mismo',
      },
    });
    expect(repo.dismissPair).not.toHaveBeenCalled();
  });

  it('answers 404 when the other merchant is not the user one', async () => {
    const repo = pairRepo();
    const { service } = build(repo);

    await expect(
      service.dismissDuplicate('user-1', 'merchant-a', 'merchant-missing'),
    ).rejects.toMatchObject({
      response: { message: 'Comercio no encontrado' },
    });
    expect(repo.dismissPair).not.toHaveBeenCalled();
  });

  it('undoes the dismissal', async () => {
    const repo = pairRepo();
    const { service } = build(repo);

    await expect(
      service.undoDismissDuplicate('user-1', 'merchant-b', 'merchant-a'),
    ).resolves.toEqual({ dismissed: false });
    expect(repo.undoDismissPair).toHaveBeenCalledWith(
      'user-1',
      'merchant-a',
      'merchant-b',
    );
  });

  it('keeps a dismissed pair out of the candidates and the count', async () => {
    const repo = {
      findMerchantById: jest
        .fn()
        .mockResolvedValue(merchantRow({ name: 'Supermercado Nacional' })),
      listMerchantComparables: jest.fn().mockResolvedValue([
        {
          id: 'merchant-1',
          name: 'Supermercado Nacional',
          normalizedKey: 'SUPERMERCADO NACIONAL',
          logoUrl: null,
          aliases: [],
        },
        {
          id: 'merchant-2',
          name: 'Supermercado Nacional 5',
          normalizedKey: 'SUPERMERCADO NACIONAL 5',
          logoUrl: null,
          aliases: [],
        },
      ]),
      listDismissedPairs: jest
        .fn()
        .mockResolvedValue([
          { merchantId: 'merchant-1', otherMerchantId: 'merchant-2' },
        ]),
      sumSpendByMerchant: jest.fn().mockResolvedValue([]),
    };
    const { service } = build(repo);

    await expect(service.duplicates('user-1', 'merchant-1')).resolves.toEqual(
      [],
    );
  });
});

describe('MerchantsService logo', () => {
  function logoRepo(overrides: Record<string, unknown> = {}) {
    return {
      findMerchantById: jest.fn().mockResolvedValue(merchantRow()),
      updateMerchant: jest.fn().mockResolvedValue({ count: 1 }),
      replaceAliases: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  function serviceWithLogos(repo: Record<string, unknown>) {
    const built = build(repo);
    const logos = (
      built.service as unknown as {
        logos: {
          ensureLogo: jest.Mock;
          saveCustomLogo: jest.Mock;
          deleteCustomLogo: jest.Mock;
          resolveUrl: jest.Mock;
        };
      }
    ).logos;
    return { ...built, logos };
  }

  it('saves the brand file and its domain on PATCH', async () => {
    const repo = logoRepo();
    const { service, logos } = serviceWithLogos(repo);
    logos.ensureLogo.mockResolvedValue('brands/netflix.com.png');

    await service.update('user-1', 'merchant-1', {
      domain: 'https://Netflix.com',
    });

    expect(logos.ensureLogo).toHaveBeenCalledWith('netflix.com');
    expect(repo.updateMerchant).toHaveBeenCalledWith('user-1', 'merchant-1', {
      domain: 'netflix.com',
      logoPath: 'brands/netflix.com.png',
      customLogoPath: null,
    });
  });

  it('deletes the own file when a brand replaces it', async () => {
    const repo = logoRepo({
      findMerchantById: jest
        .fn()
        .mockResolvedValue(
          merchantRow({ customLogoPath: 'custom/user-1/merchant-1.png' }),
        ),
    });
    const { service, logos } = serviceWithLogos(repo);

    await service.update('user-1', 'merchant-1', { domain: 'netflix.com' });

    expect(logos.deleteCustomLogo).toHaveBeenCalledWith(
      'custom/user-1/merchant-1.png',
    );
  });

  it('removes the brand logo with domain null', async () => {
    const repo = logoRepo();
    const { service, logos } = serviceWithLogos(repo);

    await service.update('user-1', 'merchant-1', { domain: null });

    expect(logos.ensureLogo).not.toHaveBeenCalled();
    expect(repo.updateMerchant).toHaveBeenCalledWith('user-1', 'merchant-1', {
      domain: null,
      logoPath: null,
      customLogoPath: null,
    });
  });

  it('rejects an invalid domain', async () => {
    const repo = logoRepo();
    const { service } = serviceWithLogos(repo);

    await expect(
      service.update('user-1', 'merchant-1', { domain: '%%%' }),
    ).rejects.toMatchObject({ response: { message: 'Dominio inválido' } });
    expect(repo.updateMerchant).not.toHaveBeenCalled();
  });

  it('stores the own upload in customLogoPath', async () => {
    const repo = logoRepo();
    const { service, logos } = serviceWithLogos(repo);
    logos.saveCustomLogo.mockResolvedValue('custom/user-1/merchant-1.png');

    await service.uploadLogo('user-1', 'merchant-1', {
      mimetype: 'image/png',
      size: 100,
      buffer: Buffer.from('x'),
    });

    expect(repo.updateMerchant).toHaveBeenCalledWith('user-1', 'merchant-1', {
      customLogoPath: 'custom/user-1/merchant-1.png',
    });
  });

  it('keeps a storage failure as 503 instead of turning it into 400', async () => {
    const repo = logoRepo();
    const { service, logos } = serviceWithLogos(repo);
    logos.saveCustomLogo.mockRejectedValue(
      new ServiceUnavailableException('Storage no está configurado'),
    );

    await expect(
      service.uploadLogo('user-1', 'merchant-1', {
        mimetype: 'image/png',
        size: 100,
        buffer: Buffer.from('x'),
      }),
    ).rejects.toMatchObject({ response: { statusCode: 503 } });
    expect(repo.updateMerchant).not.toHaveBeenCalled();
  });

  it('turns an unexpected upload failure into 400', async () => {
    const repo = logoRepo();
    const { service, logos } = serviceWithLogos(repo);
    logos.saveCustomLogo.mockRejectedValue(new Error('upload failed'));

    await expect(
      service.uploadLogo('user-1', 'merchant-1', {
        mimetype: 'image/png',
        size: 100,
        buffer: Buffer.from('x'),
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 400, message: 'upload failed' },
    });
  });

  it('deletes the own file with DELETE logo', async () => {
    const repo = logoRepo({
      findMerchantById: jest
        .fn()
        .mockResolvedValue(
          merchantRow({ customLogoPath: 'custom/user-1/merchant-1.png' }),
        ),
    });
    const { service, logos } = serviceWithLogos(repo);

    await service.deleteLogo('user-1', 'merchant-1');

    expect(repo.updateMerchant).toHaveBeenCalledWith('user-1', 'merchant-1', {
      customLogoPath: null,
    });
    expect(logos.deleteCustomLogo).toHaveBeenCalledWith(
      'custom/user-1/merchant-1.png',
    );
  });

  it('resolves the logo URL with the shared priority', async () => {
    const repo = {
      ...logoRepo(),
      sumSpendByMerchant: jest.fn().mockResolvedValue([]),
    };
    const { service, logos } = serviceWithLogos(repo);
    logos.resolveUrl.mockReturnValue('https://cdn/brands/netflix.com.png');

    const merchant = await service.get('user-1', 'merchant-1');

    expect(merchant.logoUrl).toBe('https://cdn/brands/netflix.com.png');
    expect(logos.resolveUrl).toHaveBeenCalledWith(expect.anything());
  });
});
