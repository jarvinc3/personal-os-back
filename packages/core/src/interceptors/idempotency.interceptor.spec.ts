import {
  ConflictException,
  HttpException,
  RequestTimeoutException,
} from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { PinoLogger } from 'nestjs-pino';
import { NEVER, TimeoutError, lastValueFrom, of, throwError } from 'rxjs';
import { type PrismaService } from '@personal-os/database';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { TimeoutInterceptor } from './timeout.interceptor';

type IdempotencyKeyMock = {
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  deleteMany: jest.Mock;
};

type Harness = {
  interceptor: IdempotencyInterceptor;
  idempotencyKey: IdempotencyKeyMock;
  logger: { setContext: jest.Mock; error: jest.Mock; warn: jest.Mock };
};

function createHarness(): Harness {
  const idempotencyKey: IdempotencyKeyMock = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const logger = { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const prisma = { idempotencyKey } as unknown as PrismaService;
  return {
    interceptor: new IdempotencyInterceptor(
      prisma,
      logger as unknown as PinoLogger,
    ),
    idempotencyKey,
    logger,
  };
}

function createContext({
  method = 'POST',
  url = '/api/fin/transactions',
  body = { amount: 10 },
  idempotencyKey = 'key-1',
  userId = 'user-1',
  statusCode = 201,
  headersSent = false,
}: {
  method?: string;
  url?: string;
  body?: unknown;
  idempotencyKey?: string | null;
  userId?: string | null;
  statusCode?: number;
  headersSent?: boolean;
} = {}): ExecutionContext {
  const request = {
    method,
    originalUrl: url,
    body,
    headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : {},
    user: userId ? { sub: userId } : undefined,
  };
  const response = { statusCode, headersSent };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function futureDate(): Date {
  return new Date(Date.now() + 60_000);
}

function pastDate(): Date {
  return new Date(Date.now() - 60_000);
}

async function run(
  interceptor: IdempotencyInterceptor,
  context: ExecutionContext,
  body: unknown,
): Promise<unknown> {
  const next: CallHandler = { handle: () => of(body) };
  return lastValueFrom(await interceptor.intercept(context, next));
}

function captureRequestHash(idempotencyKey: IdempotencyKeyMock): string {
  const [call] = idempotencyKey.create.mock.calls;
  return (call[0] as { data: { requestHash: string } }).data.requestHash;
}

function captureExpiresAt(idempotencyKey: IdempotencyKeyMock): unknown {
  const [call] = idempotencyKey.create.mock.calls;
  return (call[0] as { data: { expiresAt: unknown } }).data.expiresAt;
}

describe('IdempotencyInterceptor', () => {
  it('keeps the previous behavior when the header is absent', async () => {
    const { interceptor, idempotencyKey } = createHarness();

    await expect(
      run(interceptor, createContext({ idempotencyKey: null }), {
        ok: true,
      }),
    ).resolves.toEqual({ ok: true });
    expect(idempotencyKey.create).not.toHaveBeenCalled();
    expect(idempotencyKey.findUnique).not.toHaveBeenCalled();
  });

  it('ignores the header on GET', async () => {
    const { interceptor, idempotencyKey } = createHarness();

    await expect(
      run(interceptor, createContext({ method: 'GET' }), { ok: true }),
    ).resolves.toEqual({ ok: true });
    expect(idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('ignores the header when the request has no user', async () => {
    const { interceptor, idempotencyKey } = createHarness();

    await expect(
      run(interceptor, createContext({ userId: null }), { ok: true }),
    ).resolves.toEqual({ ok: true });
    expect(idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('claims the key and stores the response on a first attempt', async () => {
    const { interceptor, idempotencyKey } = createHarness();

    await expect(
      run(interceptor, createContext(), { id: 'tx-1' }),
    ).resolves.toEqual({ id: 'tx-1' });

    expect(idempotencyKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        key: 'key-1',
        method: 'POST',
        path: '/api/fin/transactions',
        status: 'IN_PROGRESS',
      }),
    });
    expect(captureExpiresAt(idempotencyKey)).toBeInstanceOf(Date);
    expect(idempotencyKey.update).toHaveBeenCalledWith({
      where: { userId_key: { userId: 'user-1', key: 'key-1' } },
      data: {
        status: 'COMPLETED',
        responseStatus: 201,
        responseBody: JSON.stringify({ id: 'tx-1' }),
      },
    });
  });

  it('replays the stored response without running the handler again', async () => {
    const { interceptor, idempotencyKey } = createHarness();
    await run(interceptor, createContext(), { id: 'tx-1' });
    const requestHash = captureRequestHash(idempotencyKey);

    idempotencyKey.findUnique.mockResolvedValue({
      id: 'row-1',
      method: 'POST',
      path: '/api/fin/transactions',
      requestHash,
      status: 'COMPLETED',
      responseBody: JSON.stringify({ id: 'tx-1' }),
      expiresAt: futureDate(),
    });

    const next = jest.fn(() => of({ id: 'tx-2' }));
    const replayedResponse = await interceptor.intercept(createContext(), {
      handle: next,
    });

    await expect(lastValueFrom(replayedResponse)).resolves.toEqual({
      id: 'tx-1',
    });
    expect(next).not.toHaveBeenCalled();
    expect(idempotencyKey.create).toHaveBeenCalledTimes(1);
  });

  it('answers 409 when the same key is reused with another body', async () => {
    const { interceptor, idempotencyKey } = createHarness();
    idempotencyKey.findUnique.mockResolvedValue({
      id: 'row-1',
      method: 'POST',
      path: '/api/fin/transactions',
      requestHash: 'other-hash',
      status: 'COMPLETED',
      responseBody: JSON.stringify({ id: 'tx-1' }),
      expiresAt: futureDate(),
    });

    await expect(
      interceptor.intercept(createContext(), { handle: () => of({}) }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers 409 when the same key points to another route', async () => {
    const { interceptor, idempotencyKey } = createHarness();
    await run(interceptor, createContext(), { id: 'tx-1' });
    const requestHash = captureRequestHash(idempotencyKey);

    idempotencyKey.findUnique.mockResolvedValue({
      id: 'row-1',
      method: 'POST',
      path: '/api/fin/accounts',
      requestHash,
      status: 'COMPLETED',
      responseBody: JSON.stringify({ id: 'tx-1' }),
      expiresAt: futureDate(),
    });

    await expect(
      interceptor.intercept(createContext(), { handle: () => of({}) }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers 409 while the same key is still in progress', async () => {
    const { interceptor, idempotencyKey } = createHarness();
    idempotencyKey.findUnique.mockResolvedValue({
      id: 'row-1',
      method: 'POST',
      path: '/api/fin/transactions',
      requestHash: 'any',
      status: 'IN_PROGRESS',
      responseBody: null,
      expiresAt: futureDate(),
    });

    await expect(
      interceptor.intercept(createContext(), { handle: () => of({}) }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('discards an expired key and runs the request again', async () => {
    const { interceptor, idempotencyKey } = createHarness();
    idempotencyKey.findUnique.mockResolvedValue({
      id: 'row-1',
      method: 'POST',
      path: '/api/fin/transactions',
      requestHash: 'any',
      status: 'COMPLETED',
      responseBody: JSON.stringify({ id: 'tx-old' }),
      expiresAt: pastDate(),
    });

    await expect(
      run(interceptor, createContext(), { id: 'tx-new' }),
    ).resolves.toEqual({ id: 'tx-new' });
    expect(idempotencyKey.delete).toHaveBeenCalledWith({
      where: { id: 'row-1' },
    });
    expect(idempotencyKey.create).toHaveBeenCalledTimes(1);
  });

  it('answers 409 when another request claimed the key at the same time', async () => {
    const { interceptor, idempotencyKey } = createHarness();
    idempotencyKey.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      interceptor.intercept(createContext(), { handle: () => of({}) }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('releases the key when the handler fails so the retry can run', async () => {
    const { interceptor, idempotencyKey } = createHarness();
    const next: CallHandler = {
      handle: () => throwError(() => new HttpException('boom', 500)),
    };

    const handlerResult = await interceptor.intercept(createContext(), next);

    await expect(lastValueFrom(handlerResult)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(idempotencyKey.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', key: 'key-1' },
    });
    expect(idempotencyKey.update).not.toHaveBeenCalled();
  });

  it('keeps the key claimed when the request times out', async () => {
    const { interceptor, idempotencyKey, logger } = createHarness();
    const next: CallHandler = {
      handle: () => throwError(() => new RequestTimeoutException('cut')),
    };

    const handlerResult = await interceptor.intercept(createContext(), next);

    await expect(lastValueFrom(handlerResult)).rejects.toBeInstanceOf(
      RequestTimeoutException,
    );
    expect(idempotencyKey.deleteMany).not.toHaveBeenCalled();
    expect(idempotencyKey.update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('keeps the key claimed when RxJS raises a bare TimeoutError', async () => {
    const { interceptor, idempotencyKey } = createHarness();
    const next: CallHandler = {
      handle: () => throwError(() => new TimeoutError()),
    };

    const handlerResult = await interceptor.intercept(createContext(), next);

    await expect(lastValueFrom(handlerResult)).rejects.toBeInstanceOf(
      TimeoutError,
    );
    expect(idempotencyKey.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps the key claimed when the TimeoutInterceptor cuts a slow handler', async () => {
    const { interceptor, idempotencyKey } = createHarness();
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(10),
    } as unknown as Reflector;
    const timeoutInterceptor = new TimeoutInterceptor(reflector);
    const context = createContext({ url: '/api/fin/sources/src-1/sync' });
    const next: CallHandler = {
      handle: () =>
        timeoutInterceptor.intercept(context, { handle: () => NEVER }),
    };

    const handlerResult = await interceptor.intercept(context, next);

    await expect(lastValueFrom(handlerResult)).rejects.toBeInstanceOf(
      RequestTimeoutException,
    );
    expect(idempotencyKey.deleteMany).not.toHaveBeenCalled();
  });

  it('ignores the key order of the body when comparing requests', async () => {
    const { interceptor, idempotencyKey } = createHarness();

    await run(interceptor, createContext({ body: { a: 1, b: 2 } }), {});
    await run(interceptor, createContext({ body: { b: 2, a: 1 } }), {});

    const hashes = idempotencyKey.create.mock.calls.map(
      ([call]) => (call as { data: { requestHash: string } }).data.requestHash,
    );
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('releases the key when the handler writes the response itself', async () => {
    const { interceptor, idempotencyKey } = createHarness();

    await run(interceptor, createContext({ headersSent: true }), undefined);

    expect(idempotencyKey.deleteMany).toHaveBeenCalledTimes(1);
    expect(idempotencyKey.update).not.toHaveBeenCalled();
  });
});
