import { STATEMENT_IMPORT_ERROR } from '../domain/statement-import-errors';
import type { StatementExtractionResult } from './ports/statement-extractor.port';
import {
  StatementPasswordError,
  type StatementPdfTextPort,
} from './ports/statement-pdf.port';
import { ProcessStatementImportUseCase } from './process-statement-import.use-case';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

function context(overrides: Record<string, unknown> = {}) {
  return {
    id: 'import-1',
    userId: 'user-1',
    cardId: 'card-1',
    accountId: null,
    parsed: {},
    card: {
      id: 'card-1',
      name: 'Visa 6506',
      balances: [{ currency: 'DOP' }],
    },
    account: null,
    lines: [],
    ...overrides,
  };
}

const statementResult: StatementExtractionResult = {
  ok: true,
  provider: 'test',
  model: 'test',
  statement: {
    header: {
      currency: 'DOP',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      previousBalance: 145320.55,
      closingBalance: 203169.25,
      minimumPayment: null,
      dueDate: null,
    },
    lines: [
      {
        date: '2026-09-02',
        description: 'SUPERMERCADO NACIONAL SRL',
        amount: 4512.3,
        currency: 'DOP',
        type: 'DEBIT',
        reference: 'REF-992001',
        categoryNameHint: 'Alimentación',
      },
      {
        date: '2026-09-05',
        description: 'PAGO NOMINA SEPTIEMBRE',
        amount: 85000,
        currency: 'DOP',
        type: 'CREDIT',
        reference: null,
        categoryNameHint: 'Nómina',
      },
    ],
  },
};

function setup(
  options: {
    extraction?: StatementExtractionResult;
    text?: string;
    textError?: Error;
    movements?: unknown[];
    categories?: unknown[];
  } = {},
) {
  const repo = {
    findImportContext: jest.fn(() => Promise.resolve(context())),
    listCategories: jest.fn(() =>
      Promise.resolve(
        options.categories ?? [
          { id: 'cat-food', name: 'Alimentación', type: 'EXPENSE' },
          { id: 'cat-payroll', name: 'Nómina', type: 'INCOME' },
        ],
      ),
    ),
    findMovementsForMatching: jest.fn(() =>
      Promise.resolve(options.movements ?? []),
    ),
    replaceLines: jest.fn(() => Promise.resolve()),
    updateResult: jest.fn(() => Promise.resolve()),
  };
  const pdfText: StatementPdfTextPort = {
    extractText: jest.fn(() =>
      options.textError
        ? Promise.reject(options.textError)
        : Promise.resolve(options.text ?? 'statement text'),
    ),
    assertReadable: jest.fn(() => Promise.resolve()),
  };
  const extractor = {
    extract: jest.fn(() =>
      Promise.resolve(options.extraction ?? statementResult),
    ),
  };
  const useCase = new ProcessStatementImportUseCase(
    repo as never,
    pdfText,
    extractor,
  );
  return { repo, extractor, useCase };
}

describe('ProcessStatementImportUseCase', () => {
  it('stores the header, the lines and their reconciliation', async () => {
    const { repo, useCase } = setup({
      movements: [
        {
          id: 'mov-1',
          transactionDate: utc(2026, 9, 2),
          description: 'Supermercado Nacional',
          merchant: null,
          amount: 4512.3,
          currency: 'DOP',
          type: 'DEBIT',
          legRole: null,
          externalReference: null,
        },
        {
          id: 'mov-extra',
          transactionDate: utc(2026, 9, 12),
          description: 'UBER TRIP',
          merchant: null,
          amount: 420,
          currency: 'DOP',
          type: 'DEBIT',
          legRole: null,
          externalReference: null,
        },
      ],
    });

    await useCase.execute({
      userId: 'user-1',
      importId: 'import-1',
      bytes: new Uint8Array([1]),
    });

    const [, lines] = repo.replaceLines.mock.calls[0] as [
      string,
      Array<Record<string, unknown>>,
    ];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      description: 'SUPERMERCADO NACIONAL SRL',
      decision: 'MATCH',
      transactionId: 'mov-1',
      categoryId: 'cat-food',
    });
    expect(lines[1]).toMatchObject({
      description: 'PAGO NOMINA SEPTIEMBRE',
      decision: 'CREATE',
      transactionId: null,
      categoryId: 'cat-payroll',
    });

    const [update] = repo.updateResult.mock.calls[0] as [
      { status: string; parsed: Record<string, unknown> },
    ];
    expect(update.status).toBe('READY');
    expect(update.parsed).toMatchObject({
      header: {
        closingBalance: 203169.25,
        previousBalance: 145320.55,
        currency: 'DOP',
      },
      counts: { lines: 2, matched: 1, missing: 1, extra: 1 },
    });
    expect(update.parsed.extra).toHaveLength(1);
  });

  it('keeps a suggested category only when the direction matches', async () => {
    const { repo, useCase } = setup({
      categories: [{ id: 'cat-food', name: 'Alimentación', type: 'INCOME' }],
    });

    await useCase.execute({
      userId: 'user-1',
      importId: 'import-1',
      bytes: new Uint8Array([1]),
    });

    const [, lines] = repo.replaceLines.mock.calls[0] as [
      string,
      Array<Record<string, unknown>>,
    ];
    expect(lines[0].categoryId).toBeNull();
  });

  it('fails with STATEMENT_PASSWORD_REQUIRED when the PDF is locked', async () => {
    const { repo, useCase } = setup({
      textError: new StatementPasswordError('locked'),
    });

    await useCase.execute({
      userId: 'user-1',
      importId: 'import-1',
      bytes: new Uint8Array([1]),
    });

    expect(repo.updateResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        error: STATEMENT_IMPORT_ERROR.PASSWORD_REQUIRED,
      }),
    );
  });

  it('fails with STATEMENT_PARSE_FAILED when the model cannot read the text', async () => {
    const { repo, useCase } = setup({
      extraction: { ok: false, reason: 'no json', retryable: true },
    });

    await useCase.execute({
      userId: 'user-1',
      importId: 'import-1',
      bytes: new Uint8Array([1]),
    });

    expect(repo.updateResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        error: STATEMENT_IMPORT_ERROR.PARSE_FAILED,
      }),
    );
  });

  it('fails when the PDF has no extractable text', async () => {
    const { repo, useCase } = setup({ text: '   ' });

    await useCase.execute({
      userId: 'user-1',
      importId: 'import-1',
      bytes: new Uint8Array([1]),
    });

    expect(repo.updateResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        error: STATEMENT_IMPORT_ERROR.PARSE_FAILED,
      }),
    );
  });

  it('does nothing when the import was deleted meanwhile', async () => {
    const { repo, useCase } = setup();
    repo.findImportContext.mockResolvedValue(null);

    await useCase.execute({
      userId: 'user-1',
      importId: 'import-1',
      bytes: new Uint8Array([1]),
    });

    expect(repo.replaceLines).not.toHaveBeenCalled();
  });
});
