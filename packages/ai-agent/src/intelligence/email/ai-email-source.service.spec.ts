import { BadRequestException } from '@nestjs/common';
import { AiEmailSourceService } from './ai-email-source.service';

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
