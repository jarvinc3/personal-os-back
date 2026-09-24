import {
  categoryTypeForTransaction,
  matchCategoryByHint,
  normalizeCategoryLabel,
  resolveCategoryIdForImport,
} from './category-type';

describe('categoryTypeForTransaction', () => {
  it('maps DEBIT to EXPENSE and CREDIT to INCOME', () => {
    expect(categoryTypeForTransaction('DEBIT')).toBe('EXPENSE');
    expect(categoryTypeForTransaction('CREDIT')).toBe('INCOME');
    expect(categoryTypeForTransaction('TRANSFER')).toBeNull();
  });
});

describe('normalizeCategoryLabel', () => {
  it('strips accents and collapses whitespace', () => {
    expect(normalizeCategoryLabel('  Alimentación  ')).toBe('alimentacion');
    expect(normalizeCategoryLabel('Cuidado   personal')).toBe('cuidado personal');
  });
});

describe('matchCategoryByHint', () => {
  const categories = [
    { id: 'exp-salary', name: 'Salario', type: 'EXPENSE' },
    { id: 'inc-salary', name: 'Salario', type: 'INCOME' },
    { id: 'exp-food', name: 'Alimentación', type: 'EXPENSE' },
  ];

  it('matches CREDIT hints to the INCOME category of the same name', () => {
    expect(matchCategoryByHint(categories, 'Salario', 'CREDIT')).toBe(
      'inc-salary',
    );
  });

  it('matches DEBIT hints to the EXPENSE category of the same name', () => {
    expect(matchCategoryByHint(categories, 'salario', 'DEBIT')).toBe(
      'exp-salary',
    );
  });

  it('matches accent-insensitive exact names', () => {
    expect(matchCategoryByHint(categories, 'Alimentacion', 'DEBIT')).toBe(
      'exp-food',
    );
  });

  it('matches a unique partial containment', () => {
    expect(
      matchCategoryByHint(
        [...categories, { id: 'exp-other', name: 'Otros', type: 'EXPENSE' }],
        'gasto alimentacion casa',
        'DEBIT',
      ),
    ).toBe('exp-food');
  });

  it('returns null when the hint is missing or the type is a transfer', () => {
    expect(matchCategoryByHint(categories, null, 'CREDIT')).toBeNull();
    expect(matchCategoryByHint(categories, 'Salario', 'TRANSFER')).toBeNull();
  });
});

describe('resolveCategoryIdForImport', () => {
  const categories = [
    { id: 'exp-food', name: 'Alimentación', type: 'EXPENSE' },
    { id: 'exp-transport', name: 'Transporte', type: 'EXPENSE' },
  ];

  it('prefers the LLM hint over merchant history', async () => {
    const findCategoryIdByMerchant = jest.fn().mockResolvedValue('exp-transport');
    await expect(
      resolveCategoryIdForImport({
        categories,
        hint: 'Alimentación',
        transactionType: 'DEBIT',
        merchant: 'Uber',
        findCategoryIdByMerchant,
      }),
    ).resolves.toEqual({ categoryId: 'exp-food', source: 'hint' });
    expect(findCategoryIdByMerchant).not.toHaveBeenCalled();
  });

  it('falls back to merchant history when hint is missing', async () => {
    const findCategoryIdByMerchant = jest
      .fn()
      .mockResolvedValue('exp-transport');
    await expect(
      resolveCategoryIdForImport({
        categories,
        hint: null,
        transactionType: 'DEBIT',
        merchant: 'Uber',
        findCategoryIdByMerchant,
      }),
    ).resolves.toEqual({
      categoryId: 'exp-transport',
      source: 'merchant_history',
    });
  });

  it('returns null when history category type does not match', async () => {
    const findCategoryIdByMerchant = jest.fn().mockResolvedValue('inc-1');
    await expect(
      resolveCategoryIdForImport({
        categories: [
          ...categories,
          { id: 'inc-1', name: 'Salario', type: 'INCOME' },
        ],
        hint: null,
        transactionType: 'DEBIT',
        merchant: 'Payroll Co',
        findCategoryIdByMerchant,
      }),
    ).resolves.toEqual({ categoryId: null, source: null });
  });
});
