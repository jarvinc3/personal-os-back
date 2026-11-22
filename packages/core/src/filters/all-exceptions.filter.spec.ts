import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { AllExceptionsFilter } from './all-exceptions.filter';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

const captureExceptionMock = captureException as unknown as jest.Mock;

const loggerMock = {
  setContext: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

function createFilter(nodeEnv = 'production'): AllExceptionsFilter {
  const config = { get: jest.fn().mockReturnValue(nodeEnv) };
  return new AllExceptionsFilter(loggerMock as never, config as never);
}

type TestResponse = {
  status: jest.Mock;
  json: jest.Mock;
  destroy: jest.Mock;
};

type RunOptions = {
  headersSent?: boolean;
  startedAt?: number;
};

function run(exception: unknown, options: RunOptions = {}): TestResponse {
  const { headersSent = false, startedAt } = options;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const destroy = jest.fn();
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        url: '/finance/accounts?token=abc',
        id: 'req-1',
        method: 'GET',
        startedAt,
      }),
      getResponse: () => ({ headersSent, status, destroy }),
    }),
  } as unknown as ArgumentsHost;
  createFilter().catch(exception, host);
  return { status, json, destroy };
}

describe('AllExceptionsFilter sentry reporting', () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
  });

  it('reports a 500 to Sentry', () => {
    run(new Error('database down'));

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('does not report a 400', () => {
    run(new BadRequestException('Invalid body'));

    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('does not report a 404', () => {
    run(new HttpException('Not found', HttpStatus.NOT_FOUND));

    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('strips the query string from the reported path', () => {
    run(new Error('database down'));

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({ path: '/finance/accounts' }),
      }),
    );
  });
});

describe('AllExceptionsFilter response writing', () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
  });

  it('writes the error body when the headers are still open', () => {
    const response = run(new BadRequestException('Invalid body'));

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledTimes(1);
    expect(response.destroy).not.toHaveBeenCalled();
  });

  it('destroys the response instead of writing over sent headers', () => {
    const response = run(new Error('turn failed'), { headersSent: true });

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
    expect(response.destroy).toHaveBeenCalledWith(expect.any(Error));
  });

  it('still reports a 500 to Sentry after the response started', () => {
    run(new Error('turn failed'), { headersSent: true });

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});

describe('AllExceptionsFilter failure log', () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
  });

  it('logs a 400 as a warning without a stack', () => {
    run(new BadRequestException('Cursor inválido'), {
      startedAt: Date.now() - 5,
    });

    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        path: '/finance/accounts',
        message: 'Cursor inválido',
      }),
      'HTTP request failed',
    );
    const logFields = loggerMock.warn.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(logFields).not.toHaveProperty('stack');
  });

  it('logs a 500 as an error with the stack', () => {
    run(new Error('database down'), { startedAt: Date.now() - 5 });

    expect(loggerMock.warn).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    const [fields, message] = loggerMock.error.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(message).toBe('HTTP request failed');
    expect(fields.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(typeof fields.stack).toBe('string');
  });

  it('reports the duration when the interceptor timed the request', () => {
    run(new BadRequestException('Cursor inválido'), {
      startedAt: Date.now() - 25,
    });

    const logFields = loggerMock.warn.mock.calls[0][0] as {
      durationMs?: number;
    };
    expect(logFields.durationMs).toBeGreaterThanOrEqual(20);
  });

  it('omits the duration when a guard rejected the request before the interceptor', () => {
    run(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED));

    const logFields = loggerMock.warn.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(logFields).not.toHaveProperty('durationMs');
  });

  it('logs a guard rejection once, as a warning and with the real status', () => {
    run(new HttpException('Authentication required', HttpStatus.UNAUTHORIZED));

    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: HttpStatus.UNAUTHORIZED }),
      'HTTP request failed',
    );
  });
});
