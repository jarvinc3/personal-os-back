import { HttpException, HttpStatus } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { lastValueFrom, of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

type LoggerMock = { setContext: jest.Mock; info: jest.Mock };

type LogFields = Record<string, unknown>;

function createLogger(): LoggerMock {
  return { setContext: jest.fn(), info: jest.fn() };
}

function createContext(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        baseUrl: '/api/finance',
        route: { path: '/loans/:id/installments' },
        url: '/api/finance/loans/42/installments?cursor=abc',
        id: 'req-1',
        user: { sub: 'user-1' },
      }),
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
}

function createInterceptor(logger: LoggerMock): LoggingInterceptor {
  return new LoggingInterceptor(logger as unknown as PinoLogger);
}

describe('LoggingInterceptor', () => {
  it('logs one line for a successful request with its duration', async () => {
    const logger = createLogger();
    const interceptor = createInterceptor(logger);

    await lastValueFrom(
      interceptor.intercept(createContext(), {
        handle: () => of({ ok: true }),
      } as CallHandler),
    );

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [fields, message] = logger.info.mock.calls[0] as [LogFields, string];
    expect(message).toBe('HTTP request completed');
    expect(fields).toMatchObject({
      method: 'GET',
      path: '/api/finance/loans/:id/installments',
      statusCode: 200,
      requestId: 'req-1',
      userId: 'user-1',
    });
    expect(typeof fields.durationMs).toBe('number');
  });

  it('timestamps the request so the filter can report the duration', async () => {
    const logger = createLogger();
    const interceptor = createInterceptor(logger);
    const request: { startedAt?: number } = {};
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;

    await lastValueFrom(
      interceptor.intercept(context, {
        handle: () => of(undefined),
      } as CallHandler),
    );

    expect(typeof request.startedAt).toBe('number');
  });

  it('does not log failures: the exception filter owns that line', async () => {
    const logger = createLogger();
    const interceptor = createInterceptor(logger);
    const failure = new HttpException(
      'Cursor inválido',
      HttpStatus.BAD_REQUEST,
    );

    await expect(
      lastValueFrom(
        interceptor.intercept(createContext(), {
          handle: () => throwError(() => failure),
        } as CallHandler),
      ),
    ).rejects.toBe(failure);

    expect(logger.info).not.toHaveBeenCalled();
  });
});
