import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { AllExceptionsFilter } from './all-exceptions.filter';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

const captureExceptionMock = captureException as unknown as jest.Mock;

function createFilter(nodeEnv = 'production'): AllExceptionsFilter {
  const logger = { setContext: jest.fn(), error: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(nodeEnv) };
  return new AllExceptionsFilter(logger as never, config as never);
}

function run(exception: unknown): void {
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        url: '/finance/accounts?token=abc',
        id: 'req-1',
        method: 'GET',
      }),
      getResponse: () => ({
        status: jest.fn().mockReturnValue({ json: jest.fn() }),
      }),
    }),
  } as unknown as ArgumentsHost;
  createFilter().catch(exception, host);
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
