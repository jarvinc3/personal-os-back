import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiEmailSourceService } from './ai-email-source.service';
import { encryptToken } from './token-encryption.util';

describe('AiEmailSourceService', () => {
  const makeService = () => new AiEmailSourceService({}, {} as never);

  const previousFetch = global.fetch;

  afterEach(() => {
    global.fetch = previousFetch;
    jest.restoreAllMocks();
  });

  it('includes scoped route classifications in the message detail', async () => {
    const classification = {
      route: 'FINANCE',
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      confidence: 0.9,
      decisionPath: 'MODEL',
      knowledgeUsed: [],
      provider: 'groq',
      model: 'test-model',
    };
    const prisma = {
      aiEmailMessage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'message-1',
          userId: 'user-1',
          classifications: [classification],
        }),
      },
      aiKnowledgeObservation: { findMany: jest.fn().mockResolvedValue([]) },
      aiHumanVerification: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const result = await new AiEmailSourceService(
      prisma as never,
      {} as never,
    ).getMessage('user-1', 'message-1');

    expect(prisma.aiEmailMessage.findFirst).toHaveBeenCalledWith({
      where: { id: 'message-1', userId: 'user-1' },
      include: {
        content: true,
        classifications: { orderBy: { route: 'asc' } },
      },
    });
    expect(result.classifications).toEqual([classification]);
    expect(result.provenance.observations).toEqual([]);
  });

  it.each([
    {
      status: 500,
      retryAfter: null,
      providerCode: 'internalError',
      errorCategory: 'temporary',
    },
    {
      status: 429,
      retryAfter: '1',
      providerCode: 'rateLimitExceeded',
      errorCategory: 'rate_limit',
    },
  ])(
    'reintenta un $status del historial y conserva la causa',
    async ({ status, retryAfter, providerCode, errorCategory }) => {
      const responses = [
        {
          ok: false,
          status,
          headers: {
            get: (name: string) => (name === 'retry-after' ? retryAfter : null),
          },
          json: () =>
            Promise.resolve({
              error: {
                status: providerCode,
                errors: [{ reason: providerCode }],
              },
            }),
        },
        {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({ historyId: '105' }),
        },
      ];
      const fetchMock = jest
        .fn()
        .mockImplementation(() => Promise.resolve(responses.shift()));
      global.fetch = fetchMock;
      const retryStates: Array<Record<string, unknown>> = [];

      await expect(
        makeService().gmailApiRequest('token', '/users/me/history', (state) => {
          retryStates.push(state);
        }),
      ).resolves.toEqual({ historyId: '105' });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(retryStates).toEqual([
        expect.objectContaining({
          status: 'waiting',
          attempt: 1,
          errorCategory,
        }),
        expect.objectContaining({
          status: 'retrying',
          attempt: 1,
          errorCategory,
        }),
      ]);
    },
  );

  it('expone el último intento y el último fallo en el dashboard', async () => {
    const finishedAt = new Date('2026-10-30T12:00:00.000Z');
    const connection = {
      id: 'connection-1',
      emailAddress: 'qa@example.com',
      isActive: true,
      initialSyncCompletedAt: new Date('2026-10-24T00:00:00.000Z'),
      lastSyncedAt: finishedAt,
      lastRecoverySyncAt: null,
      importedMessageCount: 4,
      lastSyncErrorCode: 'http_500',
      lastAttemptStartedAt: new Date('2026-10-30T11:59:00.000Z'),
      lastAttemptFinishedAt: finishedAt,
      lastAttemptResult: 'FAILED',
      lastAttemptErrorCode: 'http_500',
      lastAttemptErrorCategory: 'temporary',
      lastAttemptImportedCount: 2,
      lastAttemptPhase: 'incremental',
      lastFailureAt: finishedAt,
      lastFailureErrorCode: 'http_500',
      lastFailureErrorCategory: 'temporary',
      lastFailureImportedCount: 2,
      lastFailurePhase: 'incremental',
      reconnectRequiredAt: finishedAt,
    };
    const prisma = {
      aiEmailConnection: {
        findUnique: jest.fn().mockResolvedValue(connection),
      },
      aiEmailMessage: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({
          _min: { receivedAt: null },
          _max: { receivedAt: null },
        }),
      },
      userRole: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) },
    };
    const service = new AiEmailSourceService(prisma as never, {} as never);

    const dashboard = await service.dashboard('user-1');

    expect(dashboard.connection).toMatchObject({
      lastAttempt: {
        result: 'FAILED',
        errorCode: 'http_500',
        errorCategory: 'temporary',
        importedCount: 2,
        phase: 'incremental',
      },
      lastFailure: {
        finishedAt,
        errorCode: 'http_500',
        errorCategory: 'temporary',
        importedCount: 2,
        phase: 'incremental',
      },
      requiresReconnect: true,
    });
  });

  it('marca la conexión para reconexión cuando Google rechaza el refresh token', async () => {
    const encryptionKey = 'a'.repeat(32);
    const prisma = {
      aiEmailConnection: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'connection-1',
          isActive: true,
          accessTokenEncrypted: 'expired-access',
          refreshTokenEncrypted: encryptToken('refresh-token', encryptionKey),
          tokenExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            AI_GMAIL_CLIENT_ID: 'client-id',
            AI_GMAIL_CLIENT_SECRET: 'client-secret',
            AI_GMAIL_REDIRECT_URI: 'http://localhost/callback',
          })[key],
      ),
      getOrThrow: jest.fn().mockReturnValue(encryptionKey),
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_grant' }),
    });
    const service = new AiEmailSourceService(prisma as never, config as never);

    await expect(service.getAccessToken('connection-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    const updatePayload = prisma.aiEmailConnection.update.mock.calls[0][0].data;
    expect(updatePayload).toEqual(
      expect.objectContaining({ lastSyncErrorCode: 'invalid_grant' }),
    );
    expect(updatePayload.reconnectRequiredAt).toBeInstanceOf(Date);
  });

  it('limpia la reconexión al completar OAuth', async () => {
    const encryptionKey = 'a'.repeat(32);
    const prisma = {
      aiEmailConnection: {
        findUnique: jest.fn().mockResolvedValue({
          refreshTokenEncrypted: encryptToken('old-refresh', encryptionKey),
        }),
        upsert: jest.fn().mockResolvedValue({
          id: 'connection-1',
          userId: 'user-1',
          emailAddress: 'qa@example.com',
        }),
      },
    };
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            AI_GMAIL_CLIENT_ID: 'client-id',
            AI_GMAIL_CLIENT_SECRET: 'client-secret',
            AI_GMAIL_REDIRECT_URI: 'http://localhost/callback',
          })[key],
      ),
      getOrThrow: jest.fn().mockReturnValue(encryptionKey),
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            emailAddress: 'qa@example.com',
            historyId: '100',
          }),
      });
    const service = new AiEmailSourceService(prisma as never, config as never);
    const state = new URL(
      service.createAuthorizationUrl({ userId: 'user-1' }),
    ).searchParams.get('state');

    await service.completeAuthorization('code', state ?? '');

    expect(prisma.aiEmailConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          lastSyncErrorCode: null,
          reconnectRequiredAt: null,
        }),
      }),
    );
    const upsertArgument = prisma.aiEmailConnection.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArgument.update).not.toHaveProperty('senderFilter');
  });

  it('guarda el período y el filtro de importación al conectar', async () => {
    const encryptionKey = 'a'.repeat(32);
    const prisma = {
      aiEmailConnection: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          id: 'connection-1',
          userId: 'user-1',
          emailAddress: 'qa@example.com',
        }),
      },
    };
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            AI_GMAIL_CLIENT_ID: 'client-id',
            AI_GMAIL_CLIENT_SECRET: 'client-secret',
            AI_GMAIL_REDIRECT_URI: 'http://localhost/callback',
          })[key],
      ),
      getOrThrow: jest.fn().mockReturnValue(encryptionKey),
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            emailAddress: 'qa@example.com',
            historyId: '100',
          }),
      });
    const service = new AiEmailSourceService(prisma as never, config as never);
    const state = new URL(
      service.createAuthorizationUrl({
        userId: 'user-1',
        period: 'LAST_MONTH',
        senderFilter: '  BHD.com.do ',
      }),
    ).searchParams.get('state');

    await service.completeAuthorization('code', state ?? '');

    const upsertArgument = prisma.aiEmailConnection.upsert.mock.calls[0][0] as {
      create: { importStartAt: Date | null; senderFilter: string | null };
      update: { importStartAt?: Date; senderFilter?: string };
    };
    expect(upsertArgument.create.senderFilter).toBe('bhd.com.do');
    expect(upsertArgument.create.importStartAt).toBeInstanceOf(Date);
    expect(upsertArgument.update.senderFilter).toBe('bhd.com.do');
    expect(upsertArgument.update.importStartAt).toBeInstanceOf(Date);
  });

  it('borra el filtro de remitente con un null explícito', async () => {
    const encryptionKey = 'a'.repeat(32);
    const prisma = {
      aiEmailConnection: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          id: 'connection-1',
          userId: 'user-1',
          emailAddress: 'qa@example.com',
        }),
      },
    };
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            AI_GMAIL_CLIENT_ID: 'client-id',
            AI_GMAIL_CLIENT_SECRET: 'client-secret',
            AI_GMAIL_REDIRECT_URI: 'http://localhost/callback',
          })[key],
      ),
      getOrThrow: jest.fn().mockReturnValue(encryptionKey),
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            emailAddress: 'qa@example.com',
            historyId: '100',
          }),
      });
    const service = new AiEmailSourceService(prisma as never, config as never);
    const state = new URL(
      service.createAuthorizationUrl({ userId: 'user-1', senderFilter: null }),
    ).searchParams.get('state');

    await service.completeAuthorization('code', state ?? '');

    const upsertArgument = prisma.aiEmailConnection.upsert.mock.calls[0][0] as {
      create: { senderFilter: string | null };
      update: { senderFilter?: string | null };
    };
    expect(upsertArgument.create.senderFilter).toBeNull();
    expect(upsertArgument.update).toHaveProperty('senderFilter', null);
  });

  it('expone la configuración OAuth sin valores sensibles', () => {
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            AI_GMAIL_CLIENT_ID: 'client-id',
            AI_GMAIL_CLIENT_SECRET: 'client-secret',
            AI_GMAIL_REDIRECT_URI: 'http://localhost/callback',
            AI_GMAIL_TOKEN_ENCRYPTION_KEY: 'a'.repeat(32),
          })[key],
      ),
    };
    const service = new AiEmailSourceService({} as never, config as never);
    const diagnostics = service.oauthDiagnostics();

    expect(diagnostics).toEqual({
      configured: true,
      provider: 'GMAIL',
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      status: 'ready',
    });
    expect(JSON.stringify(diagnostics)).not.toContain('client-secret');
    expect(JSON.stringify(diagnostics)).not.toContain('client-id');
  });

  it('reporta la configuración OAuth incompleta', () => {
    const service = new AiEmailSourceService(
      {} as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
    );

    expect(service.oauthDiagnostics()).toEqual({
      configured: false,
      provider: 'GMAIL',
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      status: 'missing_oauth_configuration',
    });
  });

  it('no reintenta un 401 y conserva el código del proveedor', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: () =>
        Promise.resolve({
          error: {
            status: 'UNAUTHENTICATED',
            errors: [{ reason: 'authError' }],
          },
        }),
    });
    global.fetch = fetchMock;

    try {
      await makeService().gmailApiRequest('token', '/users/me/history');
      throw new Error('La petición debía fallar');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({ providerCode: 'authError' }),
      );
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('pide la API de Gmail con un límite de tiempo', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ messages: [] }),
    });
    global.fetch = fetchMock;

    await makeService().gmailApiRequest('token', '/users/me/profile');

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.signal).toBeInstanceOf(AbortSignal);
  });

  it('reintenta una llamada de Gmail que agota su tiempo', async () => {
    const timeout = Object.assign(new Error('timed out'), {
      name: 'TimeoutError',
    });
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: [] }),
      });
    const states: string[] = [];

    const gmailResponse = await makeService().gmailApiRequest<{
      messages: unknown[];
    }>('token', '/users/me/messages', (state) => {
      states.push(state.status);
    });

    expect(gmailResponse).toEqual({ messages: [] });
    expect(states).toEqual(['waiting', 'retrying']);
  });

  it('convierte un timeout del token en un fallo temporal con su código', async () => {
    const encryptionKey = 'a'.repeat(32);
    const prisma = {
      aiEmailConnection: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'connection-1',
          isActive: true,
          accessTokenEncrypted: 'expired-access',
          refreshTokenEncrypted: encryptToken('refresh-token', encryptionKey),
          tokenExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            AI_GMAIL_CLIENT_ID: 'client-id',
            AI_GMAIL_CLIENT_SECRET: 'client-secret',
            AI_GMAIL_REDIRECT_URI: 'http://localhost/callback',
          })[key],
      ),
      getOrThrow: jest.fn().mockReturnValue(encryptionKey),
    };
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
      );
    const service = new AiEmailSourceService(prisma as never, config as never);

    await expect(service.getAccessToken('connection-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'gmail_token_timeout',
        providerCode: 'timeout',
      }),
    });
    expect(prisma.aiEmailConnection.update).not.toHaveBeenCalled();
  });

  describe('reconexión de Gmail', () => {
    const encryptionKey = 'a'.repeat(32);
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            AI_GMAIL_CLIENT_ID: 'client-id',
            AI_GMAIL_CLIENT_SECRET: 'client-secret',
            AI_GMAIL_REDIRECT_URI: 'http://localhost/callback',
          })[key],
      ),
      getOrThrow: jest.fn().mockReturnValue(encryptionKey),
    };

    async function reconnect(existing: Record<string, unknown> | null) {
      const prisma = {
        aiEmailConnection: {
          findUnique: jest.fn().mockResolvedValue(existing),
          upsert: jest.fn().mockResolvedValue({
            id: 'connection-1',
            userId: 'user-1',
            emailAddress: 'qa@example.com',
          }),
        },
      };
      const oauthResponses = [
        {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
        },
        { emailAddress: 'qa@example.com', historyId: '4000' },
      ];
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(oauthResponses.shift()),
        }),
      );
      const service = new AiEmailSourceService(
        prisma as never,
        config as never,
      );
      const state = new URL(
        service.createAuthorizationUrl({ userId: 'user-1' }),
      ).searchParams.get('state');

      await service.completeAuthorization('code', state ?? '');

      const upsertPayload = prisma.aiEmailConnection.upsert.mock
        .calls[0][0] as {
        update: Record<string, unknown>;
      };
      return upsertPayload.update;
    }

    it('conserva el cursor anterior al reconectar la misma cuenta', async () => {
      const update = await reconnect({
        refreshTokenEncrypted: encryptToken('old-refresh', encryptionKey),
        providerCursor: '1000',
        emailAddress: 'qa@example.com',
      });

      expect(update).not.toHaveProperty('providerCursor');
    });

    it('toma el historyId nuevo cuando conecta por primera vez', async () => {
      const update = await reconnect(null);

      expect(update).toEqual(
        expect.objectContaining({ providerCursor: '4000' }),
      );
    });

    it('toma el historyId nuevo cuando reconecta otra cuenta', async () => {
      const update = await reconnect({
        refreshTokenEncrypted: encryptToken('old-refresh', encryptionKey),
        providerCursor: '1000',
        emailAddress: 'otra@example.com',
      });

      expect(update).toEqual(
        expect.objectContaining({ providerCursor: '4000' }),
      );
    });
  });
});

describe('AiEmailSourceService.listMessages', () => {
  function messageRow(id: string, receivedAt: Date) {
    return {
      id,
      receivedAt,
      fromAddress: 'alertas@banco.com',
      fromDomain: 'banco.com',
      subject: 'Consumo con tarjeta',
      processingStatus: 'PROCESSED',
      contentFingerprint: null,
    };
  }

  function makeListService(rows: unknown[]) {
    const prisma = {
      aiEmailMessage: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    return {
      prisma,
      service: new AiEmailSourceService(prisma as never, {} as never),
    };
  }

  it('combina usuario, estado, búsqueda y cursor en la misma consulta', async () => {
    const { prisma, service } = makeListService([]);
    const cursorReceivedAt = new Date('2026-11-01T10:00:00.000Z');
    const cursor = Buffer.from(
      JSON.stringify({
        receivedAt: cursorReceivedAt.toISOString(),
        id: 'message-1',
      }),
    ).toString('base64url');

    await service.listMessages({
      userId: 'user-1',
      cursor,
      q: 'Factura',
      status: 'REVIEW_REQUIRED',
    });

    expect(prisma.aiEmailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          processingStatus: 'REVIEW_REQUIRED',
          OR: [
            { receivedAt: { gt: cursorReceivedAt } },
            { receivedAt: cursorReceivedAt, id: { gt: 'message-1' } },
          ],
          AND: {
            OR: [
              { subject: { contains: 'Factura', mode: 'insensitive' } },
              {
                fromAddress: { contains: 'Factura', mode: 'insensitive' },
              },
            ],
          },
        },
        orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
        take: 51,
      }),
    );
  });

  it('pide solo el usuario cuando no hay filtros', async () => {
    const { prisma, service } = makeListService([]);

    await expect(service.listMessages({ userId: 'user-1' })).resolves.toEqual({
      items: [],
      hasMore: false,
      nextCursor: null,
    });
    expect(prisma.aiEmailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('devuelve el cursor de la última fila incluida en la página', async () => {
    const rows = Array.from({ length: 51 }, (_, index) =>
      messageRow(`message-${index}`, new Date(Date.UTC(2026, 9, 1, 10, index))),
    );
    const { service } = makeListService(rows);

    const page = await service.listMessages({ userId: 'user-1' });

    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(
      JSON.parse(
        Buffer.from(page.nextCursor ?? '', 'base64url').toString('utf8'),
      ),
    ).toEqual({
      receivedAt: rows[49].receivedAt.toISOString(),
      id: 'message-49',
    });
  });

  it('respeta el tamaño de página pedido por el cliente', async () => {
    const rows = Array.from({ length: 4 }, (_, index) =>
      messageRow(`message-${index}`, new Date(Date.UTC(2026, 9, 1, 10, index))),
    );
    const { prisma, service } = makeListService(rows);

    const page = await service.listMessages({ userId: 'user-1', limit: 3 });

    expect(prisma.aiEmailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 }),
    );
    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(true);
    expect(
      JSON.parse(
        Buffer.from(page.nextCursor ?? '', 'base64url').toString('utf8'),
      ),
    ).toEqual({
      receivedAt: rows[2].receivedAt.toISOString(),
      id: 'message-2',
    });
  });

  it.each([
    'no-es-un-cursor',
    Buffer.from(JSON.stringify({ id: 7 })).toString('base64url'),
    Buffer.from(
      JSON.stringify({ receivedAt: 'ayer', id: 'message-1' }),
    ).toString('base64url'),
  ])('rechaza el cursor inválido %s sin consultar', async (cursor) => {
    const { prisma, service } = makeListService([]);

    await expect(
      service.listMessages({ userId: 'user-1', cursor }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiEmailMessage.findMany).not.toHaveBeenCalled();
  });
});
