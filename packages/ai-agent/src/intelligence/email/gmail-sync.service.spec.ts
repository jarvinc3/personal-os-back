import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
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
    const classification = {
      processPendingForUser: jest
        .fn()
        .mockResolvedValue({ processed: 0, modelCalls: 0, budget: 1 }),
    };
    const service = new GmailSyncService(
      prisma,
      source as never,
      config as never,
      events as never,
      deletion as never,
      classification as never,
    );
    const syncStateWrites = (): Array<Record<string, unknown>> =>
      prisma.aiEmailConnection.update.mock.calls
        .map(([call]) => call.data.syncState)
        .filter((state): state is Record<string, unknown> => Boolean(state));
    return {
      current,
      prisma,
      source,
      config,
      events,
      deletion,
      service,
      syncStateWrites,
    };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('records a successful attempt without overwriting the last failure', async () => {
    const { prisma, service } = makeFixture();

    await service.syncConnection('connection-1');

    const attemptUpdate = prisma.aiEmailConnection.update.mock.calls
      .map(([call]) => call.data)
      .find((data) => data.lastAttemptResult === 'SUCCEEDED');
    expect(attemptUpdate).toEqual(
      expect.objectContaining({
        lastAttemptResult: 'SUCCEEDED',
        lastAttemptErrorCode: null,
        lastAttemptErrorCategory: null,
        lastAttemptImportedCount: 0,
        lastAttemptPhase: 'bootstrap',
        reconnectRequiredAt: null,
      }),
    );
    expect(attemptUpdate).not.toHaveProperty('lastFailureAt');
    expect(attemptUpdate).not.toHaveProperty('lastFailureErrorCode');
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

  it('keeps the original history cursor while paginating', async () => {
    const { current, prisma, source, service } = makeFixture();
    current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
    current.providerCursor = '100';
    source.gmailApiRequest
      .mockResolvedValueOnce({
        historyId: '105',
        nextPageToken: 'page-2',
        history: [],
      })
      .mockResolvedValueOnce({ historyId: '106', history: [] });

    expect(await service.syncConnection('connection-1')).toEqual({
      connected: true,
      imported: 0,
      bootstrapComplete: true,
    });
    expect(source.gmailApiRequest).toHaveBeenNthCalledWith(
      1,
      'token',
      expect.stringContaining('startHistoryId=100'),
      expect.any(Function),
    );
    expect(source.gmailApiRequest).toHaveBeenNthCalledWith(
      2,
      'token',
      expect.stringMatching(/startHistoryId=100.*pageToken=page-2/),
      expect.any(Function),
    );
    expect(prisma.aiEmailConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: { providerCursor: '106', importedMessageCount: { increment: 0 } },
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
    const { current, source, service, syncStateWrites } = makeFixture();
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
    const states = syncStateWrites();
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

  it('recovers from the last successful sync instead of a seven-day window', async () => {
    const { current, prisma, source, service } = makeFixture();
    const lastSyncedAt = new Date(Date.now() - 10 * 86400_000);
    current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
    current.lastSyncedAt = lastSyncedAt;
    source.gmailApiRequest
      .mockResolvedValueOnce({ historyId: '200' })
      .mockResolvedValueOnce({ messages: [], resultSizeEstimate: 0 });

    expect(await service.syncConnection('connection-1')).toEqual({
      connected: true,
      imported: 0,
      recovered: true,
      bootstrapComplete: true,
    });
    const messagesPath = decodeURIComponent(
      source.gmailApiRequest.mock.calls[1][1] as string,
    );
    expect(messagesPath).toContain(
      `after:${Math.floor(lastSyncedAt.getTime() / 1000)}`,
    );
    const states = prisma.aiEmailConnection.update.mock.calls
      .map(([call]) => call.data.syncState)
      .filter(Boolean);
    expect(states.at(-1)).not.toHaveProperty('recoveryRange');
  });

  it('paginates the entire recovery range', async () => {
    const { current, prisma, source, service } = makeFixture();
    current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
    current.lastSyncedAt = new Date(Date.now() - 10 * 86400_000);
    source.gmailApiRequest
      .mockResolvedValueOnce({ historyId: '200' })
      .mockResolvedValueOnce({ messages: [], nextPageToken: 'page-2' })
      .mockResolvedValueOnce({ messages: [], resultSizeEstimate: 0 });

    expect(await service.syncConnection('connection-1')).toEqual({
      connected: true,
      imported: 0,
      recovered: true,
      bootstrapComplete: true,
    });
    expect(source.gmailApiRequest).toHaveBeenCalledTimes(3);
    const secondPagePath = decodeURIComponent(
      source.gmailApiRequest.mock.calls[2][1] as string,
    );
    expect(secondPagePath).toContain('pageToken=page-2');
    expect(prisma.aiEmailConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: expect.objectContaining({ providerCursor: '200' }),
    });
  });

  it('records the recovery range when the provider fails mid-recovery', async () => {
    const { current, prisma, source, service } = makeFixture();
    const lastSyncedAt = new Date(Date.now() - 10 * 86400_000);
    current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
    current.lastSyncedAt = lastSyncedAt;
    source.gmailApiRequest
      .mockResolvedValueOnce({ historyId: '200' })
      .mockRejectedValueOnce(
        new BadRequestException({ providerCode: 'http_503' }),
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
        errorCode: 'http_503',
        recoveryRange: {
          from: new Date(
            Math.floor(lastSyncedAt.getTime() / 1000) * 1000,
          ).toISOString(),
          to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      }),
    );
  });

  it('classifies a missing OAuth configuration and keeps its code', async () => {
    const { prisma, source, service, syncStateWrites } = makeFixture();
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
      data: expect.objectContaining({
        lastSyncErrorCode: 'gmail_oauth_not_configured',
        lastAttemptResult: 'FAILED',
        lastAttemptErrorCode: 'gmail_oauth_not_configured',
        lastAttemptErrorCategory: 'configuration',
        lastFailureErrorCode: 'gmail_oauth_not_configured',
        lastFailureErrorCategory: 'configuration',
      }),
    });
    const states = syncStateWrites();
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
      const { current, prisma, source, service, syncStateWrites } =
        makeFixture();
      current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
      current.providerCursor = '100';
      source.gmailApiRequest.mockRejectedValueOnce(
        new BadRequestException({ providerCode }),
      );

      await expect(
        service.syncConnection('connection-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      const failureUpdate = prisma.aiEmailConnection.update.mock.calls
        .map(([call]) => call.data)
        .find((updatePayload) => updatePayload.lastAttemptResult === 'FAILED');
      expect(failureUpdate).toEqual(
        expect.objectContaining({
          lastSyncErrorCode: providerCode,
          lastAttemptResult: 'FAILED',
          lastAttemptErrorCode: providerCode,
          lastAttemptErrorCategory: 'authorization',
          lastFailureErrorCode: providerCode,
          lastFailureErrorCategory: 'authorization',
        }),
      );
      expect(failureUpdate).not.toHaveProperty('reconnectRequiredAt');
      const states = syncStateWrites();
      expect(states.at(-1)).toEqual(
        expect.objectContaining({
          status: 'failed',
          errorCode: providerCode,
          errorCategory: 'authorization',
        }),
      );
    },
  );

  it.each([
    {
      label: 'Google invalida el refresh token',
      error: new ServiceUnavailableException({
        code: 'gmail_token_refresh_failed',
        providerCode: 'invalid_grant',
      }),
      code: 'invalid_grant',
    },
    {
      label: 'falta el refresh token',
      error: new ServiceUnavailableException('gmail_refresh_token_missing'),
      code: 'gmail_refresh_token_missing',
    },
  ])(
    'marks the connection for reconnection when $label',
    async ({ error, code }) => {
      const { prisma, source, service } = makeFixture();
      source.getAccessToken.mockRejectedValueOnce(error);

      await expect(
        service.syncConnection('connection-1'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      const failureUpdate = prisma.aiEmailConnection.update.mock.calls
        .map(([call]) => call.data)
        .find((updatePayload) => updatePayload.lastAttemptResult === 'FAILED');
      expect(failureUpdate).toEqual(
        expect.objectContaining({
          lastSyncErrorCode: code,
          lastAttemptResult: 'FAILED',
          lastAttemptErrorCode: code,
          lastAttemptErrorCategory: 'authorization',
          lastFailureErrorCode: code,
          lastFailureErrorCategory: 'authorization',
        }),
      );
      expect(failureUpdate?.reconnectRequiredAt).toBeInstanceOf(Date);
    },
  );

  it('omite las conexiones que requieren reconexión en el ciclo automático', async () => {
    const { prisma, service } = makeFixture();

    await service.syncAllActiveConnections();

    expect(prisma.aiEmailConnection.findMany).toHaveBeenCalledWith({
      where: { isActive: true, reconnectRequiredAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(prisma.aiEmailConnection.update).not.toHaveBeenCalled();
  });

  it('keeps an unknown provider code and classifies it as unknown', async () => {
    const { current, source, service, syncStateWrites } = makeFixture();
    current.initialSyncCompletedAt = new Date('2026-10-24T00:00:00Z');
    current.providerCursor = '100';
    source.gmailApiRequest.mockRejectedValueOnce(
      new BadRequestException({ providerCode: 'mystery_provider_failure' }),
    );

    await expect(service.syncConnection('connection-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const states = syncStateWrites();
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
      expect(prisma.aiEmailConnection.update).toHaveBeenCalledWith({
        where: { id: 'connection-1' },
        data: expect.objectContaining({
          lastAttemptResult: 'FAILED',
          lastAttemptErrorCode: 'RESOURCE_EXHAUSTED',
          lastAttemptErrorCategory: 'rate_limit',
          lastFailureErrorCode: 'RESOURCE_EXHAUSTED',
          lastFailureErrorCategory: 'rate_limit',
        }),
      });
    } finally {
      service.onModuleDestroy();
    }
  });

  it('avisa y no programa el ciclo sin configuración OAuth', () => {
    const { source, service } = makeFixture();
    source.oauthDiagnostics.mockReturnValue({
      configured: false,
      status: 'missing_oauth_configuration',
    });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    service.onModuleInit();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Gmail OAuth is not configured'),
    );
    expect(warn.mock.calls[0][0]).toContain('missing_oauth_configuration');
    expect(warn.mock.calls[0][0]).not.toContain('client-secret');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('programa el ciclo automático con la configuración OAuth completa', () => {
    const { service } = makeFixture();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const unref = jest.fn();
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue({
      unref,
    } as unknown as NodeJS.Timeout);

    service.onModuleInit();

    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Gmail OAuth is not configured'),
    );
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(unref).toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('marks an interrupted run as worker_interrupted', async () => {
    const { prisma, source, service, syncStateWrites } = makeFixture();
    source.oauthDiagnostics.mockReturnValue({
      configured: false,
      status: 'missing_oauth_configuration',
    });
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

    const states = syncStateWrites();
    expect(states.at(-1)).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'worker_interrupted',
      }),
    );
    expect(prisma.aiEmailConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: expect.objectContaining({
        lastAttemptResult: 'INTERRUPTED',
        lastAttemptErrorCode: 'worker_interrupted',
        lastAttemptImportedCount: 1,
        lastAttemptPhase: 'incremental',
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

  it('rechaza el reinicio sin una conexión de Gmail', async () => {
    const { prisma, deletion, service } = makeFixture();
    prisma.aiEmailConnection.findUnique.mockResolvedValueOnce(null);

    await expect(service.resetEmailCorpus('user-1')).rejects.toMatchObject({
      response: { code: 'GMAIL_NOT_CONNECTED' },
    });
    expect(deletion.removeEmailData).not.toHaveBeenCalled();
  });

  it('rechaza el reinicio mientras el sync espera por cuota', async () => {
    const { current, deletion, service } = makeFixture();
    current.syncState = {
      status: 'waiting',
      errorCode: 'rate_limit_retry_scheduled',
    };

    await expect(service.resetEmailCorpus('user-1')).rejects.toMatchObject({
      response: { code: 'GMAIL_SYNC_IN_PROGRESS' },
    });
    expect(deletion.removeEmailData).not.toHaveBeenCalled();
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
