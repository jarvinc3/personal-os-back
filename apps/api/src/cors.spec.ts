import { resolveNonProductionCorsOrigin } from './cors';

describe('resolveNonProductionCorsOrigin', () => {
  const resolveOrigin = resolveNonProductionCorsOrigin({
    allowedOrigins: ['http://localhost:3000'],
    sameServerOrigins: ['http://localhost:3100'],
  });

  it('lets a request without Origin through without CORS headers', () => {
    const callback = jest.fn();

    resolveOrigin(undefined, callback);

    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('allows a configured origin', () => {
    const callback = jest.fn();

    resolveOrigin('http://localhost:3000', callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('allows the API own origin', () => {
    const callback = jest.fn();

    resolveOrigin('http://localhost:3100', callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('rejects an origin outside the allowlist', () => {
    const callback = jest.fn();

    resolveOrigin('http://evil.example', callback);

    expect(callback).toHaveBeenCalledWith(
      new Error('Origin http://evil.example not allowed by CORS'),
      false,
    );
  });

  it('allows any origin when the allowlist is *', () => {
    const resolveWildcard = resolveNonProductionCorsOrigin({
      allowedOrigins: ['*'],
      sameServerOrigins: [],
    });
    const callback = jest.fn();

    resolveWildcard('https://app.example.com', callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });
});
