import { isAllowedCorsOrigin, parseCorsOriginPatterns } from './cors-origins';

const PREVIEW_PATTERN =
  '^https://personal-os-web-git-[a-z0-9-]+-collado-studios\\.vercel\\.app$';
const PREVIEW_ORIGIN =
  'https://personal-os-web-git-fix-326-atajos-hero-c7ddee-collado-studios.vercel.app';

describe('parseCorsOriginPatterns', () => {
  it('returns no patterns when the variable is unset or blank', () => {
    expect(parseCorsOriginPatterns(undefined)).toEqual([]);
    expect(parseCorsOriginPatterns('   ')).toEqual([]);
  });

  it('compiles a CSV of anchored patterns and trims blanks', () => {
    const patterns = parseCorsOriginPatterns(
      ` ${PREVIEW_PATTERN} , ^https://qa\\.example\\.com$ `,
    );

    expect(patterns).toHaveLength(2);
    expect(patterns[0].test(PREVIEW_ORIGIN)).toBe(true);
    expect(patterns[1].test('https://qa.example.com')).toBe(true);
  });

  it('rejects a pattern that is not anchored at both ends', () => {
    expect(() =>
      parseCorsOriginPatterns('https://personal-os-web-git-.*\\.vercel\\.app'),
    ).toThrow('must be anchored with ^ and $');
  });

  it('rejects a pattern that is not a valid regular expression', () => {
    expect(() => parseCorsOriginPatterns('^https://[a-$.vercel.app$')).toThrow(
      'Invalid CORS_ORIGIN_PATTERNS entry',
    );
  });
});

describe('isAllowedCorsOrigin', () => {
  const originPatterns = parseCorsOriginPatterns(PREVIEW_PATTERN);

  it('allows a listed origin', () => {
    const allowed = isAllowedCorsOrigin({
      origin: 'http://localhost:3000',
      allowedOrigins: ['http://localhost:3000'],
    });

    expect(allowed).toBe(true);
  });

  it('allows any origin when the list is *', () => {
    const allowed = isAllowedCorsOrigin({
      origin: 'https://app.example.com',
      allowedOrigins: ['*'],
    });

    expect(allowed).toBe(true);
  });

  it('allows a branch preview that matches the pattern', () => {
    const allowed = isAllowedCorsOrigin({
      origin: PREVIEW_ORIGIN,
      allowedOrigins: ['http://localhost:3000'],
      originPatterns,
    });

    expect(allowed).toBe(true);
  });

  it('rejects a lookalike domain that the anchored pattern does not cover', () => {
    expect(
      isAllowedCorsOrigin({
        origin: `${PREVIEW_ORIGIN}.evil.example`,
        allowedOrigins: [],
        originPatterns,
      }),
    ).toBe(false);
    expect(
      isAllowedCorsOrigin({
        origin:
          'https://personal-os-web-git-fix-326-atajos-hero-otro-team.vercel.app',
        allowedOrigins: [],
        originPatterns,
      }),
    ).toBe(false);
    // Unescaped dots would turn the domain into a wildcard.
    expect(
      isAllowedCorsOrigin({
        origin: 'https://personal-os-web-git-x-collado-studiosXvercelXapp',
        allowedOrigins: [],
        originPatterns,
      }),
    ).toBe(false);
  });

  it('rejects an unlisted origin when there are no patterns', () => {
    const allowed = isAllowedCorsOrigin({
      origin: PREVIEW_ORIGIN,
      allowedOrigins: ['http://localhost:3000'],
    });

    expect(allowed).toBe(false);
  });
});
