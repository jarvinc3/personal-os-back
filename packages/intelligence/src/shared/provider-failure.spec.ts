import {
  buildProviderFailureEvidenceCode,
  buildProviderFailureLogDetails,
  getProviderFailureCause,
  MAX_PROVIDER_MESSAGE_LENGTH,
  sanitizeProviderErrorMessage,
} from './provider-failure';

function providerError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

describe('getProviderFailureCause', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [402, 'quota'],
    [408, 'network'],
    [429, 'rate_limit'],
    [500, 'server'],
    [503, 'server'],
    [529, 'server'],
  ] as const)('maps HTTP %i to %s', (status, cause) => {
    expect(getProviderFailureCause(providerError('failed', status))).toBe(
      cause,
    );
  });

  it('maps a network error code without HTTP status', () => {
    expect(
      getProviderFailureCause(
        Object.assign(new Error('request failed'), { code: 'ECONNRESET' }),
      ),
    ).toBe('network');
  });

  it('maps provider messages when the SDK exposes no status', () => {
    expect(getProviderFailureCause(new Error('fetch failed'))).toBe('network');
    expect(getProviderFailureCause(new Error('rate limit reached'))).toBe(
      'rate_limit',
    );
    expect(getProviderFailureCause(new Error('insufficient credits'))).toBe(
      'quota',
    );
    expect(getProviderFailureCause(new Error('invalid api key'))).toBe('auth');
    expect(getProviderFailureCause(new Error('service unavailable'))).toBe(
      'server',
    );
  });

  it('keeps an unrecognized failure as unknown', () => {
    expect(getProviderFailureCause(providerError('bad request', 400))).toBe(
      'unknown',
    );
    expect(getProviderFailureCause(new Error('unexpected response'))).toBe(
      'unknown',
    );
  });
});

describe('buildProviderFailureEvidenceCode', () => {
  it('records the cause, status and retry decision', () => {
    expect(
      buildProviderFailureEvidenceCode({
        cause: 'rate_limit',
        httpStatus: 429,
        retryable: true,
      }),
    ).toBe('PROVIDER_FAILURE:cause=rate_limit:status=429:retryable=true');
  });

  it('marks a failure without an HTTP status', () => {
    expect(
      buildProviderFailureEvidenceCode({
        cause: 'network',
        httpStatus: null,
        retryable: false,
      }),
    ).toBe('PROVIDER_FAILURE:cause=network:status=none:retryable=false');
  });
});

describe('buildProviderFailureLogDetails', () => {
  it('combines the provider, status, cause and fallback decision', () => {
    expect(
      buildProviderFailureLogDetails({
        error: providerError('too many requests', 429),
        provider: 'Groq',
        model: 'qwen/qwen3.8-27b',
        retryable: true,
        fallback: true,
      }),
    ).toEqual({
      provider: 'Groq',
      model: 'qwen/qwen3.8-27b',
      httpStatus: 429,
      retryable: true,
      fallback: true,
      cause: 'rate_limit',
      message: 'too many requests',
    });
  });
});

describe('sanitizeProviderErrorMessage', () => {
  it('removes credentials from a provider message', () => {
    const message = sanitizeProviderErrorMessage(
      new Error(
        'Authorization: Bearer gsk_live_secret123 apiKey=sk-or-v1-secret123 {"apiKey":"gsk_other_secret123"}',
      ),
    );

    expect(message).not.toContain('gsk_live_secret123');
    expect(message).not.toContain('sk-or-v1-secret123');
    expect(message).not.toContain('gsk_other_secret123');
    expect(message).not.toContain('"apiKey"');
    expect(message).toContain('[redacted]');
    expect(message).toContain('[body omitted]');
  });

  it('truncates a long provider message', () => {
    const message = sanitizeProviderErrorMessage(new Error('x'.repeat(1_000)));

    expect(message).toHaveLength(MAX_PROVIDER_MESSAGE_LENGTH);
  });

  it('returns null when the provider rejected without a message', () => {
    expect(sanitizeProviderErrorMessage({ status: 503 })).toBeNull();
  });
});
