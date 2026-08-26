import {
  buildMobileOAuthRedirect,
  buildWebOAuthRedirect,
  isAllowlistedReturnTo,
} from './oauth-client-redirect';

describe('oauth-client-redirect', () => {
  const cors = 'http://localhost:5173,https://app.example.com';

  it('builds the stable mobile deep link', () => {
    expect(buildMobileOAuthRedirect(true)).toBe(
      'personal-os://finance/oauth/callback?success=1',
    );
    expect(buildMobileOAuthRedirect(false)).toBe(
      'personal-os://finance/oauth/callback?success=false',
    );
  });

  it('allowlists returnTo by origin only', () => {
    expect(
      isAllowlistedReturnTo('http://localhost:5173/finance/oauth', cors),
    ).toBe(true);
    expect(
      isAllowlistedReturnTo('https://evil.example/phish', cors),
    ).toBe(false);
    expect(isAllowlistedReturnTo('javascript:alert(1)', cors)).toBe(false);
  });

  it('appends success on an allowlisted returnTo', () => {
    expect(
      buildWebOAuthRedirect(
        'http://localhost:5173/finance/oauth',
        cors,
        true,
      ),
    ).toBe('http://localhost:5173/finance/oauth?success=true');
    expect(
      buildWebOAuthRedirect('https://evil.example/x', cors, true),
    ).toBeNull();
  });
});
