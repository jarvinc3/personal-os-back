import { ConflictException, HttpException } from '@nestjs/common';
import { GmailSyncService } from './gmail-sync.service';

describe('GmailSyncService', () => {
  const connection = () => ({
    id: 'connection-1',
    userId: 'user-1',
    isActive: true,
    initialSyncCompletedAt: null as Date | null,
    bootstrapPageToken: null as string | null,
    bootstrapStartedAt: null as Date | null,
    providerCursor: null as string | null,
    lastSyncedAt: null as Date | null,
    syncState: null as Record<string, unknown> | null,
  });
  const makeFixture = () => {
    const current = connection();
    const prisma = {
      aiEmailConnection: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve(current)),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      aiEmailMessage: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'stored-1' }),
      },
      $transaction: jest.fn(),
    };
    const source = {
      getAccessToken: jest.fn().mockResolvedValue('token'),
      gmailApiRequest: jest.fn().mockResolvedValue({ messages: [] }),
      oauthDiagnostics: jest.fn().mockReturnValue({ configured: true }),
    };
    const config = {
      get: jest.fn((key: string) => (key === 'NODE_ENV' ? 'development' : 1)),
    };
    const events = { emit: jest.fn() };
    const service = new GmailSyncService(
      prisma as never,
      source as never,
      config as never,
      events as never,
    );
    return { current, prisma, source, config, events, service };
  };

  it('imports a bootstrap message with sanitized content and completes bootstrap', async () => {
    const { prisma, source, service, events } = makeFixture();
    source.gmailApiRequest
      .mockResolvedValueOnce({
        messages: [{ id: 'gmail-1' }],
        resultSizeEstimate: 1,
      })
      .mockResolvedValueOnce({
        id: 'gmail-1',
        threadId: 'thread-1',
        internalDate: '1761393600000',
        payload: {
          headers: [
            { name: 'From', value: 'Tienda <ventas@EXAMPLE.COM>' },
            { name: 'Subject', value: ' Pedido ' },
          ],
          parts: [
            {
              mimeType: 'text/html',
              body: {
                data: Buffer.from(
                  '<script>bad()</script><b>Compra &amp; envío</b>',
                ).toString('base64url'),
              },
            },
          ],
        },
      });

    expect(await service.syncConnection('connection-1')).toEqual({
      connected: true,
      imported: 1,
      bootstrapComplete: true,
    });
    expect(prisma.aiEmailMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromAddress: 'ventas@EXAMPLE.COM',
        fromDomain: 'example.com',
        subject: 'Pedido',
        content: {
          create: expect.objectContaining({
            sanitizedBody: 'Compra & envío',
            canonicalBody: 'Compra & envío',
          }),
        },
      }),
    });
    expect(prisma.aiEmailConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: expect.objectContaining({
        initialSyncCompletedAt: expect.any(Date),
        importedMessageCount: { increment: 1 },
      }),
    });
    expect(events.emit).toHaveBeenCalled();
  });

  it('keeps the next bootstrap page and skips an already imported message', async () => {
    const { current, prisma, source, service } = makeFixture();
    current.bootstrapPageToken = 'page-1';
    source.gmailApiRequest.mockResolvedValueOnce({
      messages: [{ id: 'gmail-1' }],
      nextPageToken: 'page-2',
      resultSizeEstimate: 10,
    });
    prisma.aiEmailMessage.findUnique.mockResolvedValueOnce({ id: 'stored-1' });

    expect(await service.syncConnection('connection-1')).toEqual({
      connected: true,
      imported: 0,
      bootstrapComplete: false,
    });
    expect(source.gmailApiRequest).toHaveBeenCalledWith(
      'token',
      expect.stringContaining('pageToken=page-1'),
      expect.any(Function),
    );
    expect(prisma.aiEmailMessage.create).not.toHaveBeenCalled();
    expect(prisma.aiEmailConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: expect.objectContaining({ bootstrapPageToken: 'page-2' }),
    });
  });

  it('advances an incremental history cursor after importing a message', async () => {
    const { current, prisma, source, service } = makeFixture();
    current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
    current.providerCursor = '100';
    source.gmailApiRequest.mockResolvedValueOnce({
      id: 'gmail-2',
      snippet: 'Compra 1250',
      payload: { headers: [{ name: 'From', value: 'bank@example.com' }] },
    });
    const previousFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          historyId: '105',
          history: [{ messagesAdded: [{ message: { id: 'gmail-2' } }] }],
        }),
    }) as typeof fetch;
    try {
      expect(await service.syncConnection('connection-1')).toEqual({
        connected: true,
        imported: 1,
        bootstrapComplete: true,
      });
      expect(prisma.aiEmailConnection.update).toHaveBeenCalledWith({
        where: { id: 'connection-1' },
        data: { providerCursor: '105', importedMessageCount: { increment: 1 } },
      });
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('recovers a missing history cursor using the Gmail message list', async () => {
    const { current, prisma, source, service } = makeFixture();
    current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
    source.gmailApiRequest
      .mockResolvedValueOnce({ historyId: '200' })
      .mockResolvedValueOnce({ messages: [], resultSizeEstimate: 0 });

    expect(await service.syncConnection('connection-1')).toEqual({
      connected: true,
      imported: 0,
      recovered: true,
      bootstrapComplete: true,
    });
    expect(prisma.aiEmailConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: expect.objectContaining({
        providerCursor: '200',
        lastRecoverySyncAt: expect.any(Date),
      }),
    });
  });

  it('schedules a bounded retry for a provider rate limit', async () => {
    const { source, prisma, service } = makeFixture();
    source.getAccessToken.mockRejectedValueOnce(
      new HttpException({ providerCode: 'http_429' }, 429),
    );
    try {
      expect(await service.syncConnection('connection-1')).toEqual({
        connected: true,
        imported: 0,
        retryScheduled: true,
      });
      expect(prisma.aiEmailConnection.update).toHaveBeenCalledWith({
        where: { id: 'connection-1' },
        data: expect.objectContaining({
          syncState: expect.objectContaining({
            status: 'waiting',
            errorCategory: 'rate_limit',
          }),
        }),
      });
    } finally {
      service.onModuleDestroy();
    }
  });

  it('reports sync state and prevents corpus reset while sync is active', async () => {
    const { current, prisma, service } = makeFixture();
    current.syncState = {
      status: 'waiting',
      errorCode: 'rate_limit_retry_scheduled',
    };
    expect(await service.isSyncingForUser('user-1')).toBe(true);
    expect(await service.getProgressForUser('user-1')).toEqual(
      current.syncState,
    );
    current.syncState = { status: 'running' };
    await expect(service.resetEmailCorpus('user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('resets all EMAIL_V1 rows and clears the connection cursor', async () => {
    const { current, prisma, service } = makeFixture();
    current.syncState = { status: 'completed' };
    const tx = {
      aiDataset: {
        findUnique: jest.fn().mockResolvedValue({ id: 'dataset-1' }),
      },
      aiAnalysisRun: { deleteMany: jest.fn().mockResolvedValue({}) },
      aiDatasetItem: { deleteMany: jest.fn().mockResolvedValue({}) },
      aiKnowledgeObservation: { deleteMany: jest.fn().mockResolvedValue({}) },
      aiHumanVerification: { deleteMany: jest.fn().mockResolvedValue({}) },
      aiEmailMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
      aiEmailConnection: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (value: typeof tx) => Promise<number>) => callback(tx),
    );

    expect(await service.resetEmailCorpus('user-1')).toEqual({
      connected: true,
      deletedMessages: 4,
    });
    expect(tx.aiHumanVerification.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', targetType: 'EMAIL_MESSAGE' },
    });
    expect(tx.aiEmailConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: expect.objectContaining({
        providerCursor: null,
        importedMessageCount: 0,
      }),
    });
  });
});
