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

type TestResponse = {
  status: jest.Mock;
  json: jest.Mock;
  destroy: jest.Mock;
};

function run(exception: unknown, headersSent = false): TestResponse {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const destroy = jest.fn();
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        url: '/finance/accounts?token=abc',
        id: 'req-1',
        method: 'GET',
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
    const response = run(new Error('turn failed'), true);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
    expect(response.destroy).toHaveBeenCalledWith(expect.any(Error));
  });

  it('still reports a 500 to Sentry after the response started', () => {
    run(new Error('turn failed'), true);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
