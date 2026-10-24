import { IngestionService } from './ingestion.service';
import type { FinancialImportCandidatesPort } from './ports/financial-import-candidates.port';
describe('IngestionService pending assignment', () => {
  const listPendingAssignmentCandidatesPage = jest.fn();
  const listRecentCandidatesPage = jest.fn();
  const findCandidateById = jest.fn();
  const listCategories = jest.fn();
  const listInstitutionDestinations = jest.fn();
  const persistCandidate = jest.fn();
  const repo = {
    listPendingAssignmentCandidatesPage,
    listRecentCandidatesPage,
    findCandidateById,
    listCategories,
    listInstitutionDestinations,
    persistCandidate,
  } as unknown as FinancialImportCandidatesPort;

  const ownership = {
    assertAccountOwned: jest.fn().mockResolvedValue({
      id: 'acc-1',
      institutionId: 'inst-1',
      isActive: true,
    }),
    assertCardOwned: jest.fn(),
  };
  const importEmail = { execute: jest.fn() };
  const ledger = {
    findLatestCategoryIdByMerchant: jest.fn().mockResolvedValue(null),
  };

  const service = new IngestionService(
    repo,
    ownership as never,
    importEmail as never,
    ledger as never,
    { suggest: jest.fn().mockResolvedValue(null) } as never,
  );

  const pendingMessage = {
    id: 'em-1',
    sourceId: 'src-1',
    sourceReference: 'msg-1',
    outcome: 'PENDING_ASSIGNMENT' as const,
    instrumentHint: 'ACCOUNT',
    lastFourHint: '1234',
    accountNumberHint: '5678',
    extractedPayload: {
      amount: 12.5,
      currency: 'DOP',
      type: 'DEBIT' as const,
      transactionDate: '2026-08-01',
      description: 'Coffee',
      merchant: 'Cafe',
      bankStatusNormalized: 'APPROVED' as const,
      statusConfidence: 0.9,
    },
    provider: 'groq',
    model: 'test',
    reason: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    source: {
      institutionId: 'inst-1',
      connection: { emailAddress: 'user@gmail.com' },
      institution: { name: 'Bank' },
    },
    transaction: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    listCategories.mockResolvedValue([]);
    persistCandidate.mockResolvedValue({ id: 'em-1' });
    importEmail.execute.mockResolvedValue({ id: 'tx-1' });
  });

  it('lists pending messages without tokens', async () => {
    listPendingAssignmentCandidatesPage.mockResolvedValue([pendingMessage]);

    await expect(
      service.listPendingAssignment('user-1', { limit: 20 }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: 'em-1',
          institutionId: 'inst-1',
          lastFourHint: '1234',
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('lists recent extract outcomes including imported mail', async () => {
    listRecentCandidatesPage.mockResolvedValue([
      { ...pendingMessage, outcome: 'IMPORTED' },
    ]);

    await expect(
      service.listRecentMessages('user-1', { limit: 20 }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: 'em-1',
          outcome: 'IMPORTED',
          institutionName: 'Bank',
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('returns the existing transaction when assignment is retried after import', async () => {
    findCandidateById.mockResolvedValue({
      ...pendingMessage,
      outcome: 'IMPORTED',
      transaction: { id: 'tx-1' },
    });

    await expect(
      service.assignPendingMessage('user-1', 'em-1', { accountId: 'acc-1' }),
    ).resolves.toEqual({ assigned: true, transactionId: 'tx-1' });
    expect(importEmail.execute).not.toHaveBeenCalled();
  });

  it('imports a pending message onto the chosen account', async () => {
    findCandidateById.mockResolvedValue(pendingMessage);

    await expect(
      service.assignPendingMessage('user-1', 'em-1', { accountId: 'acc-1' }),
    ).resolves.toEqual({ assigned: true, transactionId: 'tx-1' });
    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        accountId: 'acc-1',
        importReference: 'em-1',
      }),
    );
  });

  it('retries automatic routing and stays pending when still ambiguous', async () => {
    findCandidateById.mockResolvedValue({
      ...pendingMessage,
      accountNumberHint: null,
      lastFourHint: null,
    });
    listInstitutionDestinations.mockResolvedValue([
      [
        { id: 'acc-1', accountNumberLast4: '1111' },
        { id: 'acc-2', accountNumberLast4: '2222' },
      ],
      [],
    ]);

    await expect(
      service.retryPendingMessage('user-1', 'em-1'),
    ).resolves.toMatchObject({ id: 'em-1', institutionId: 'inst-1' });
    expect(importEmail.execute).not.toHaveBeenCalled();
  });

  it('retries pending assignment using the stored account number hint', async () => {
    findCandidateById.mockResolvedValue(pendingMessage);
    listInstitutionDestinations.mockResolvedValue([
      [
        { id: 'acc-1', accountNumberLast4: '5678' },
        { id: 'acc-2', accountNumberLast4: '0000' },
      ],
      [],
    ]);

    await expect(
      service.retryPendingMessage('user-1', 'em-1'),
    ).resolves.toEqual({ assigned: true, transactionId: 'tx-1' });
    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ accountId: 'acc-1', importReference: 'em-1' }),
    );
  });
});
