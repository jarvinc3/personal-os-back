import { categoryTypeForTransaction, matchCategoryByHint } from './category-type';

describe('categoryTypeForTransaction', () => {
  it('maps DEBIT to EXPENSE and CREDIT to INCOME', () => {
    expect(categoryTypeForTransaction('DEBIT')).toBe('EXPENSE');
    expect(categoryTypeForTransaction('CREDIT')).toBe('INCOME');
    expect(categoryTypeForTransaction('TRANSFER')).toBeNull();
  });
});

describe('matchCategoryByHint', () => {
  const categories = [
    { id: 'exp-salary', name: 'Salario', type: 'EXPENSE' },
    { id: 'inc-salary', name: 'Salario', type: 'INCOME' },
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

  it('returns null when the hint is missing or the type is a transfer', () => {
    expect(matchCategoryByHint(categories, null, 'CREDIT')).toBeNull();
    expect(matchCategoryByHint(categories, 'Salario', 'TRANSFER')).toBeNull();
  });
});
