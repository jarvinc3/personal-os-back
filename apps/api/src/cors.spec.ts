import { parseCorsOriginPatterns } from '@personal-os/config';
import {
  buildCorsConfiguration,
  parseCorsOrigins,
  resolveNonProductionCorsOrigin,
} from './cors';

const PREVIEW_ORIGIN =
  'https://personal-os-web-git-fix-326-atajos-hero-c7ddee-collado-studios.vercel.app';

describe('resolveNonProductionCorsOrigin', () => {
  const resolveOrigin = resolveNonProductionCorsOrigin({
    allowedOrigins: ['http://localhost:3000'],
    sameServerOrigins: ['http://localhost:3100'],
    originPatterns: [],
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

  it('rejects an origin outside the allowlist without an error', () => {
    const callback = jest.fn();

    resolveOrigin('http://evil.example', callback);

    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('allows any origin when the allowlist is *', () => {
    const resolveWildcard = resolveNonProductionCorsOrigin({
      allowedOrigins: ['*'],
      sameServerOrigins: [],
      originPatterns: [],
    });
    const callback = jest.fn();

    resolveWildcard('https://app.example.com', callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  describe('with preview patterns', () => {
    const resolvePreviewOrigin = resolveNonProductionCorsOrigin({
      allowedOrigins: ['http://localhost:3000'],
      sameServerOrigins: [],
      originPatterns: parseCorsOriginPatterns(
        '^https://personal-os-web-git-[a-z0-9-]+-collado-studios\\.vercel\\.app$',
      ),
    });

    it('allows a branch preview origin', () => {
      const callback = jest.fn();

      resolvePreviewOrigin(PREVIEW_ORIGIN, callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('rejects a lookalike domain without an error', () => {
      const callback = jest.fn();

      resolvePreviewOrigin(`${PREVIEW_ORIGIN}.evil.example`, callback);

      expect(callback).toHaveBeenCalledWith(null, false);
    });
  });
});

describe('parseCorsOrigins', () => {
  it('trims entries and drops empty ones', () => {
    expect(
      parseCorsOrigins(' https://one.example , , https://two.example '),
    ).toEqual(['https://one.example', 'https://two.example']);
  });
});

describe('buildCorsConfiguration', () => {
  it('rejects a wildcard origin in production', () => {
    expect(() =>
      buildCorsConfiguration({
        isProduction: true,
        corsOrigin: '*',
        corsOriginPatterns: '',
        port: 3100,
      }),
    ).toThrow(
      'In production CORS_ORIGIN must be set to the exact frontend origin.',
    );
  });

  it('uses the exact origin in production', () => {
    const configuration = buildCorsConfiguration({
      isProduction: true,
      corsOrigin: 'https://app.example.com',
      corsOriginPatterns: '',
      port: 3100,
    });

    expect(configuration.origin).toBe('https://app.example.com');
  });

  it('keeps every configured origin in production', () => {
    const configuration = buildCorsConfiguration({
      isProduction: true,
      corsOrigin: 'https://one.example.com, https://two.example.com',
      corsOriginPatterns: '',
      port: 3100,
    });

    expect(configuration.origin).toEqual([
      'https://one.example.com',
      'https://two.example.com',
    ]);
  });

  it('allows the API origin and preview patterns outside production', () => {
    const configuration = buildCorsConfiguration({
      isProduction: false,
      corsOrigin: 'http://localhost:3000',
      corsOriginPatterns: '^https://preview-[a-z]+\\.example$',
      port: 3100,
    });
    const resolver = configuration.origin;
    if (typeof resolver !== 'function') {
      throw new Error('Expected a CORS origin resolver outside production');
    }

    const sameServerCallback = jest.fn();
    resolver('http://localhost:3100', sameServerCallback);
    expect(sameServerCallback).toHaveBeenCalledWith(null, true);

    const previewCallback = jest.fn();
    resolver('https://preview-abc.example', previewCallback);
    expect(previewCallback).toHaveBeenCalledWith(null, true);

    const foreignCallback = jest.fn();
    resolver('https://evil.example', foreignCallback);
    expect(foreignCallback).toHaveBeenCalledWith(null, false);
    expect(configuration.methods).toEqual([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ]);
    expect(configuration.credentials).toBe(true);
  });
});
