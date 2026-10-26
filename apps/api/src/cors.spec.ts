import { parseCorsOriginPatterns } from '@personal-os/config';
import { resolveNonProductionCorsOrigin } from './cors';

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
