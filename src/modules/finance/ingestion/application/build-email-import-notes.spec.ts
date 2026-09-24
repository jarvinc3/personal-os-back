import { buildEmailImportNotes } from './build-email-import-notes';

describe('buildEmailImportNotes', () => {
  it('returns null when there is nothing to report', () => {
    expect(
      buildEmailImportNotes({
        llmNotes: null,
        categoryId: 'cat-1',
        categorySource: 'hint',
        status: 'CONFIRMED',
      }),
    ).toBeNull();
  });

  it('keeps LLM notes and appends uncategorized warning', () => {
    expect(
      buildEmailImportNotes({
        llmNotes: 'Comercio poco claro.',
        categoryId: null,
        categorySource: null,
        categoryNameHint: 'Snacks',
        status: 'CONFIRMED',
      }),
    ).toBe(
      'Comercio poco claro. Sin categoría asignada (hint: Snacks).',
    );
  });

  it('mentions merchant history and pending status', () => {
    expect(
      buildEmailImportNotes({
        llmNotes: null,
        categoryId: 'cat-1',
        categorySource: 'merchant_history',
        status: 'PENDING',
      }),
    ).toBe(
      'Categoría tomada de un movimiento anterior del mismo comercio. Confirma el estado del movimiento.',
    );
  });
});
