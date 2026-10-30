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
