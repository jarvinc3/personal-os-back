import { scrubSentryEvent, SENTRY_REDACTED_VALUE } from './sentry-scrubber';

describe('scrubSentryEvent', () => {
  it('returns the event untouched when there is no request', () => {
    const event = { message: 'boom' };

    expect(scrubSentryEvent(event)).toBe(event);
  });

  it('drops the whole request body', () => {
    const event = {
      request: {
        method: 'POST',
        data: { amount: '1000.00', description: 'salary' },
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request?.data).toBeUndefined();
  });

  it('removes authorization and cookie headers', () => {
    const event = {
      request: {
        headers: {
          Authorization: 'Bearer secret',
          Cookie: 'session=abc',
          'Set-Cookie': 'session=abc',
          'Content-Type': 'application/json',
        },
      },
    };

    expect(scrubSentryEvent(event).request?.headers).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('redacts token-like header values', () => {
    const event = {
      request: {
        headers: { 'X-Api-Key': 'abc', 'X-Request-Id': 'req-1' },
      },
    };

    expect(scrubSentryEvent(event).request?.headers).toEqual({
      'X-Api-Key': SENTRY_REDACTED_VALUE,
      'X-Request-Id': 'req-1',
    });
  });

  it('removes cookies and redacts tokens in an object query string', () => {
    const event = {
      request: {
        cookies: { session: 'abc' },
        query_string: { access_token: 'abc', page: '1' },
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.query_string).toEqual({
      access_token: SENTRY_REDACTED_VALUE,
      page: '1',
    });
  });

  it('redacts tokens in a raw query string and keeps other params', () => {
    const event = {
      request: { query_string: '?token=abc&page=1' },
    };

    expect(scrubSentryEvent(event).request?.query_string).toBe(
      '?token=%5BFiltered%5D&page=1',
    );
  });
});
