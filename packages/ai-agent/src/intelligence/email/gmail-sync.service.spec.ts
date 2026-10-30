import {
  BadRequestException,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
    const deletion = {
      removeEmailData: jest.fn().mockResolvedValue({ deletedMessages: 0 }),
    };
    const service = new GmailSyncService(
      prisma,
      source as never,
      config as never,
      events as never,
      deletion as never,
    );
    return {
      current,
      prisma,
      source,
      config,
      events,
      deletion,
      service,
    };
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
    source.gmailApiRequest
      .mockResolvedValueOnce({
        historyId: '105',
        history: [{ messagesAdded: [{ message: { id: 'gmail-2' } }] }],
      })
      .mockResolvedValueOnce({
        id: 'gmail-2',
        snippet: 'Compra 1250',
        payload: { headers: [{ name: 'From', value: 'bank@example.com' }] },
      });

    expect(await service.syncConnection('connection-1')).toEqual({
      connected: true,
      imported: 1,
      bootstrapComplete: true,
    });
    expect(source.gmailApiRequest).toHaveBeenNthCalledWith(
      1,
      'token',
      expect.stringContaining('/users/me/history?'),
      expect.any(Function),
    );
    expect(prisma.aiEmailConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: { providerCursor: '105', importedMessageCount: { increment: 1 } },
    });
  });

  it('recovers when Gmail no longer has the history cursor', async () => {
    const { current, source, service } = makeFixture();
    current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
    current.providerCursor = '100';
    source.gmailApiRequest
      .mockRejectedValueOnce(
        new BadRequestException({ providerCode: 'notFound' }),
      )
      .mockResolvedValueOnce({ historyId: '200' })
      .mockResolvedValueOnce({ messages: [], resultSizeEstimate: 0 });

    expect(await service.syncConnection('connection-1')).toEqual({
      connected: true,
      imported: 0,
      recovered: true,
      bootstrapComplete: true,
    });
  });

  it('reports waiting and retrying states while the history read retries', async () => {
    const { current, prisma, source, service } = makeFixture();
    current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
    current.providerCursor = '100';
    source.gmailApiRequest.mockImplementationOnce(
      async (_token, _path, onRetryState) => {
        await onRetryState?.({
          status: 'waiting',
          retryAt: Date.now() + 1_000,
          attempt: 1,
          errorCategory: 'temporary',
        });
        await onRetryState?.({
          status: 'retrying',
          attempt: 1,
          errorCategory: 'temporary',
        });
        throw new BadRequestException({
          code: 'gmail_api_request_failed',
          providerCode: 'http_503',
        });
      },
    );

    await expect(service.syncConnection('connection-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const states = prisma.aiEmailConnection.update.mock.calls
      .map(([call]) => call.data.syncState)
      .filter(Boolean);
    expect(states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'waiting',
          errorCategory: 'temporary',
        }),
        expect.objectContaining({
          status: 'retrying',
          errorCategory: 'temporary',
        }),
      ]),
    );
    expect(states.at(-1)).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'http_503',
        errorCategory: 'temporary',
      }),
    );
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

  it('classifies a missing OAuth configuration and keeps its code', async () => {
    const { prisma, source, service } = makeFixture();
    source.getAccessToken.mockRejectedValueOnce(
      new ServiceUnavailableException({
        code: 'gmail_oauth_not_configured',
      }),
    );

    await expect(service.syncConnection('connection-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.aiEmailConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: { lastSyncErrorCode: 'gmail_oauth_not_configured' },
    });
    const states = prisma.aiEmailConnection.update.mock.calls
      .map(([call]) => call.data.syncState)
      .filter(Boolean);
    expect(states.at(-1)).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'gmail_oauth_not_configured',
        errorCategory: 'configuration',
      }),
    );
  });

  it.each(['http_401', 'http_403', 'insufficientPermissions'])(
    'classifies %s as authorization and keeps the provider code',
    async (providerCode) => {
      const { current, prisma, source, service } = makeFixture();
      current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
      current.providerCursor = '100';
      source.gmailApiRequest.mockRejectedValueOnce(
        new BadRequestException({ providerCode }),
      );

      await expect(
        service.syncConnection('connection-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.aiEmailConnection.update).toHaveBeenCalledWith({
        where: { id: 'connection-1' },
        data: { lastSyncErrorCode: providerCode },
      });
      const states = prisma.aiEmailConnection.update.mock.calls
        .map(([call]) => call.data.syncState)
        .filter(Boolean);
      expect(states.at(-1)).toEqual(
        expect.objectContaining({
          status: 'failed',
          errorCode: providerCode,
          errorCategory: 'authorization',
        }),
      );
    },
  );

  it('keeps an unknown provider code and classifies it as unknown', async () => {
    const { current, prisma, source, service } = makeFixture();
    current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
    current.providerCursor = '100';
    source.gmailApiRequest.mockRejectedValueOnce(
      new BadRequestException({ providerCode: 'mystery_provider_failure' }),
    );

    await expect(service.syncConnection('connection-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const states = prisma.aiEmailConnection.update.mock.calls
      .map(([call]) => call.data.syncState)
      .filter(Boolean);
    expect(states.at(-1)).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'mystery_provider_failure',
        errorCategory: 'unknown',
      }),
    );
  });

  it('keeps the provider code when a history rate limit schedules a retry', async () => {
    const { current, prisma, source, service } = makeFixture();
    current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
    current.providerCursor = '100';
    source.gmailApiRequest.mockRejectedValueOnce(
      new BadRequestException({ providerCode: 'RESOURCE_EXHAUSTED' }),
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
            errorCode: 'rate_limit_retry_scheduled',
            providerErrorCode: 'RESOURCE_EXHAUSTED',
            errorCategory: 'rate_limit',
          }),
        }),
      });
    } finally {
      service.onModuleDestroy();
    }
  });

  it('marks an interrupted run as worker_interrupted', async () => {
    const { prisma, source, service } = makeFixture();
    source.oauthDiagnostics.mockReturnValue({ configured: false });
    prisma.aiEmailConnection.findMany.mockResolvedValueOnce([
      {
        id: 'connection-1',
        userId: 'user-1',
        syncState: {
          status: 'running',
          phase: 'incremental',
          attempt: 0,
          processedThisRun: 2,
          importedThisRun: 1,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    ]);

    service.onModuleInit();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const states = prisma.aiEmailConnection.update.mock.calls
      .map(([call]) => call.data.syncState)
      .filter(Boolean);
    expect(states.at(-1)).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'worker_interrupted',
      }),
    );
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

  it('usa la ruta de lápidas para reiniciar el corpus', async () => {
    const { current, deletion, service } = makeFixture();
    current.syncState = { status: 'completed' };
    deletion.removeEmailData.mockResolvedValue({ deletedMessages: 4 });

    expect(await service.resetEmailCorpus('user-1')).toEqual({
      connected: true,
      deletedMessages: 4,
    });
    expect(deletion.removeEmailData).toHaveBeenCalledWith({ userId: 'user-1' });
  });
});
