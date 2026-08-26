import { AnalyticsService } from './analytics.service';
import type { AnalyticsRepository } from '../infrastructure/analytics.repository';

describe('AnalyticsService.getSpendingByCategory', () => {
  const grouped = (
    rows: Array<{ categoryId: string | null; total: number }>,
  ) =>
    rows.map((row) => ({
      categoryId: row.categoryId,
      _sum: { amountBaseCurrency: row.total },
    }));

  const createService = (repo: Partial<AnalyticsRepository>) =>
    new AnalyticsService(repo as AnalyticsRepository);

  it('attaches name color and icon for known categories and keeps totals', async () => {
    const getSpendingByCategory = jest.fn().mockResolvedValue(
      grouped([
        { categoryId: 'cat-food', total: 80 },
        { categoryId: 'cat-home', total: 20 },
      ]),
    );
    const findCategoriesByIds = jest.fn().mockResolvedValue([
      { id: 'cat-food', name: 'Comida', color: '#f00', icon: '🍽️' },
      { id: 'cat-home', name: 'Hogar', color: '#0f0', icon: '🏠' },
    ]);

    const result = await createService({
      getSpendingByCategory,
      findCategoriesByIds,
    }).getSpendingByCategory('user-1', '2026-08-01', '2026-08-31');

    expect(findCategoriesByIds).toHaveBeenCalledWith('user-1', [
      'cat-food',
      'cat-home',
    ]);
    expect(result).toEqual([
      {
        categoryId: 'cat-food',
        name: 'Comida',
        color: '#f00',
        icon: '🍽️',
        total: 80,
      },
      {
        categoryId: 'cat-home',
        name: 'Hogar',
        color: '#0f0',
        icon: '🏠',
        total: 20,
      },
    ]);
  });

  it('uses Sin categoría when categoryId is null', async () => {
    const result = await createService({
      getSpendingByCategory: jest
        .fn()
        .mockResolvedValue(grouped([{ categoryId: null, total: 15 }])),
      findCategoriesByIds: jest.fn().mockResolvedValue([]),
    }).getSpendingByCategory('user-1');

    expect(result).toEqual([
      {
        categoryId: null,
        name: 'Sin categoría',
        color: null,
        icon: null,
        total: 15,
      },
    ]);
  });

  it('falls back when the category row is gone and keeps the total', async () => {
    const result = await createService({
      getSpendingByCategory: jest
        .fn()
        .mockResolvedValue(
          grouped([{ categoryId: 'deleted-cat', total: 42 }]),
        ),
      findCategoriesByIds: jest.fn().mockResolvedValue([]),
    }).getSpendingByCategory('user-1');

    expect(result).toEqual([
      {
        categoryId: 'deleted-cat',
        name: 'Categoría no disponible',
        color: null,
        icon: null,
        total: 42,
      },
    ]);
  });

  it('returns an empty list without looking up categories', async () => {
    const findCategoriesByIds = jest.fn().mockResolvedValue([]);
    const result = await createService({
      getSpendingByCategory: jest.fn().mockResolvedValue([]),
      findCategoriesByIds,
    }).getSpendingByCategory('user-1');

    expect(findCategoriesByIds).toHaveBeenCalledWith('user-1', []);
    expect(result).toEqual([]);
  });
});
