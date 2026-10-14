import { BadRequestException, ConflictException } from '@nestjs/common';
import { STATEMENT_IMPORT_ERROR } from '../domain/statement-import-errors';
import {
  StatementPasswordError,
  type StatementPdfTextPort,
} from './ports/statement-pdf.port';
import { StatementImportsService } from './statement-imports.service';
import type { StatementImportContext } from '../infrastructure/statement-imports.repository';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

function parsedStatement(overrides: Record<string, unknown> = {}) {
  return {
    header: {
      currency: 'DOP',
      periodStart: '2026-08-25',
      periodEnd: '2026-09-24',
      previousBalance: 32450,
      closingBalance: 31685.74,
      minimumPayment: 1584.29,
      dueDate: '2026-10-15',
    },
    period: {
      from: utc(2026, 8, 25).toISOString(),
      to: utc(2026, 9, 24).toISOString(),
    },
    counts: { lines: 1, matched: 0, missing: 1, extra: 0 },
    extra: [],
    ...overrides,
  };
}

function context(overrides: Partial<StatementImportContext> = {}) {
  return {
    id: 'import-1',
    userId: 'user-1',
    cardId: 'card-1',
    accountId: null,
    statementId: null,
    status: 'READY',
    parsed: parsedStatement(),
    error: null,
    createdAt: utc(2026, 9, 25),
    updatedAt: utc(2026, 9, 25),
    appliedAt: null,
    card: { id: 'card-1', name: 'Visa 6506', balances: [{ currency: 'DOP' }] },
    account: null,
    lines: [
      {
        id: 'line-1',
        importId: 'import-1',
        date: utc(2026, 9, 2),
        description: 'SUPERMERCADO NACIONAL SRL',
        amount: 4512.3,
        currency: 'DOP',
        type: 'DEBIT',
        reference: null,
        categoryId: null,
        transactionId: null,
        decision: 'CREATE',
        createdAt: utc(2026, 9, 25),
        updatedAt: utc(2026, 9, 25),
      },
    ],
    ...overrides,
  } as unknown as StatementImportContext;
}

function setup(options: { context?: StatementImportContext } = {}) {
  const repo = {
    createImport: jest.fn(() => Promise.resolve({ id: 'import-1' })),
    findImportContext: jest.fn(() =>
      Promise.resolve(options.context ?? context()),
    ),
    listCategories: jest.fn(() => Promise.resolve([])),
    findTargetBalance: jest.fn(() =>
      Promise.resolve({
        currency: 'DOP',
        currentBalance: 149000,
        creditLimit: 150000,
      }),
    ),
    updateResult: jest.fn(() => Promise.resolve()),
    updateLine: jest.fn(() => Promise.resolve(1)),
    linkLineTransaction: jest.fn(() => Promise.resolve()),
    markApplied: jest.fn(() => Promise.resolve()),
  };
  const ownership = {
    assertCardOwned: jest.fn(() => Promise.resolve({ id: 'card-1' })),
    assertAccountOwned: jest.fn(() => Promise.resolve({ id: 'account-1' })),
  };
  const processImport = { execute: jest.fn(() => Promise.resolve()) };
  const createTransaction = {
    execute: jest.fn((_userId: string, command: unknown) =>
      Promise.resolve({ id: `tx-${Math.random()}`, command }),
    ),
  };
  const adjustBalance = { execute: jest.fn(() => Promise.resolve()) };
  const cardStatements = {
    upsertStatement: jest.fn(() => Promise.resolve('statement-1')),
  };
  const pdfText: StatementPdfTextPort = {
    extractText: jest.fn(() => Promise.resolve('text')),
    assertReadable: jest.fn(() => Promise.resolve()),
  };
  const uploads = {
    write: jest.fn(() => Promise.resolve()),
    read: jest.fn(),
    remove: jest.fn(() => Promise.resolve()),
  };
  const service = new StatementImportsService(
    repo as never,
    ownership as never,
    processImport as never,
    createTransaction as never,
    adjustBalance as never,
    cardStatements as never,
    pdfText,
    uploads,
    undefined,
  );
  return {
    repo,
    ownership,
    processImport,
    createTransaction,
    adjustBalance,
    cardStatements,
    pdfText,
    uploads,
    service,
  };
}

const file = {
  buffer: Buffer.from([1, 2, 3]),
  mimetype: 'application/pdf',
  size: 3,
  originalname: 'x.pdf',
};

describe('StatementImportsService', () => {
  it('rejects an upload without a file', async () => {
    const { service } = setup();

    await expect(
      service.createFromUpload({
        userId: 'user-1',
        cardId: 'card-1',
        accountId: null,
        file: undefined,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('asks for the password without creating an import', async () => {
    const { service, repo, pdfText } = setup();
    (pdfText.assertReadable as jest.Mock).mockRejectedValueOnce(
      new StatementPasswordError('locked'),
    );

    await expect(
      service.createFromUpload({
        userId: 'user-1',
        cardId: 'card-1',
        accountId: null,
        file,
      }),
    ).rejects.toMatchObject({
      response: { code: STATEMENT_IMPORT_ERROR.PASSWORD_REQUIRED },
    });
    expect(repo.createImport).not.toHaveBeenCalled();
  });

  it('parses inline when the queue is unavailable', async () => {
    const { service, processImport, uploads } = setup();

    const created = await service.createFromUpload({
      userId: 'user-1',
      cardId: 'card-1',
      accountId: null,
      file,
    });

    expect(created).toEqual({ importId: 'import-1' });
    expect(uploads.write).not.toHaveBeenCalled();
    expect(processImport.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', importId: 'import-1' }),
    );
  });

  it('enqueues the parse when the queue is available', async () => {
    const mocks = setup();
    const queue = { add: jest.fn(() => Promise.resolve()) };
    const serviceWithQueue = new StatementImportsService(
      mocks.repo as never,
      mocks.ownership as never,
      mocks.processImport as never,
      mocks.createTransaction as never,
      mocks.adjustBalance as never,
      mocks.cardStatements as never,
      mocks.pdfText,
      mocks.uploads,
      queue as never,
    );

    await serviceWithQueue.createFromUpload({
      userId: 'user-1',
      cardId: 'card-1',
      accountId: null,
      file,
      password: 'secret',
    });

    expect(mocks.uploads.write).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ importId: 'import-1', password: 'secret' }),
      expect.any(Object),
    );
    expect(mocks.processImport.execute).not.toHaveBeenCalled();
  });

  it('creates only the marked lines and closes the card statement', async () => {
    const { service, repo, createTransaction, cardStatements } = setup();

    await service.apply({
      userId: 'user-1',
      importId: 'import-1',
      adjust: false,
    });

    expect(createTransaction.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        cardId: 'card-1',
        type: 'DEBIT',
        amount: 4512.3,
        currency: 'DOP',
        status: 'CONFIRMED',
      }),
      'MANUAL',
    );
    expect(repo.linkLineTransaction).toHaveBeenCalledWith(
      'line-1',
      expect.any(String),
    );
    expect(cardStatements.upsertStatement).toHaveBeenCalledWith(
      expect.objectContaining({
        cardId: 'card-1',
        currency: 'DOP',
        cycleEnd: utc(2026, 9, 24),
        closingBalance: 31685.74,
        minimumPayment: 1584.29,
        minimumSource: 'IMPORTED',
        status: 'CLOSED',
      }),
    );
    expect(repo.markApplied).toHaveBeenCalledWith({
      importId: 'import-1',
      statementId: 'statement-1',
    });
  });

  it('is idempotent when the import was already applied', async () => {
    const { service, repo, createTransaction, cardStatements } = setup({
      context: context({ status: 'APPLIED', appliedAt: utc(2026, 9, 26) }),
    });

    await service.apply({
      userId: 'user-1',
      importId: 'import-1',
      adjust: true,
    });

    expect(createTransaction.execute).not.toHaveBeenCalled();
    expect(cardStatements.upsertStatement).not.toHaveBeenCalled();
    expect(repo.markApplied).not.toHaveBeenCalled();
  });

  it('adjusts the card debt to the closing balance when asked', async () => {
    const { service, adjustBalance } = setup();

    await service.apply({
      userId: 'user-1',
      importId: 'import-1',
      adjust: true,
    });

    expect(adjustBalance.execute).toHaveBeenCalledWith('user-1', {
      cardId: 'card-1',
      currency: 'DOP',
      balance: 150000 - 31685.74,
    });
  });

  it('refuses to apply an import that is not ready', async () => {
    const { service } = setup({ context: context({ status: 'PARSING' }) });

    await expect(
      service.apply({ userId: 'user-1', importId: 'import-1', adjust: false }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to apply a discarded import', async () => {
    const { service } = setup({ context: context({ status: 'DISCARDED' }) });

    await expect(
      service.apply({ userId: 'user-1', importId: 'import-1', adjust: false }),
    ).rejects.toMatchObject({
      response: { code: STATEMENT_IMPORT_ERROR.DISCARDED },
    });
  });

  it('requires a transaction to mark a line as matched', async () => {
    const { service } = setup();

    await expect(
      service.updateLine({
        userId: 'user-1',
        importId: 'import-1',
        lineId: 'line-1',
        decision: 'MATCH',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to edit lines after applying', async () => {
    const { service } = setup({ context: context({ status: 'APPLIED' }) });

    await expect(
      service.updateLine({
        userId: 'user-1',
        importId: 'import-1',
        lineId: 'line-1',
        decision: 'IGNORE',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to discard an applied import', async () => {
    const { service } = setup({ context: context({ status: 'APPLIED' }) });

    await expect(service.discard('user-1', 'import-1')).rejects.toMatchObject({
      response: { code: STATEMENT_IMPORT_ERROR.ALREADY_APPLIED },
    });
  });

  it('discards a ready import', async () => {
    const { service, repo } = setup();

    await service.discard('user-1', 'import-1');

    expect(repo.updateResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'DISCARDED' }),
    );
  });
});
