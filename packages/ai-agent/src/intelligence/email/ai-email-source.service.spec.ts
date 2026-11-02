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
      service.createAuthorizationUrl('user-1'),
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
});
