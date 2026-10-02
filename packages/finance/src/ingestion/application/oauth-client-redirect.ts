const MOBILE_OAUTH_CALLBACK = 'personal-os://finance/oauth/callback';

export function buildMobileOAuthRedirect(success: boolean): string {
  return `${MOBILE_OAUTH_CALLBACK}?success=${success ? '1' : 'false'}`;
}

export function parseAllowedOrigins(corsOrigin: string): string[] {
  return corsOrigin
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((origin) => {
      if (origin === '*') {
        return [];
      }
      try {
        return [new URL(origin).origin];
      } catch {
        return [];
      }
    });
}

export function isAllowlistedReturnTo(
  returnTo: string,
  corsOrigin: string,
): boolean {
  let url: URL;
  try {
    url = new URL(returnTo);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  if (url.username || url.password) {
    return false;
  }
  return parseAllowedOrigins(corsOrigin).includes(url.origin);
}

export function buildWebOAuthRedirect(
  returnTo: string,
  corsOrigin: string,
  success: boolean,
): string | null {
  if (!isAllowlistedReturnTo(returnTo, corsOrigin)) {
    return null;
  }
  const url = new URL(returnTo);
  url.searchParams.set('success', success ? 'true' : 'false');
  return url.toString();
}

export const WEB_OAUTH_FALLBACK_PATH =
  '/finance/accounts/sync?sheet=oauth-gmail-result';

export function buildFallbackWebOAuthRedirect(
  corsOrigin: string,
  success: boolean,
): string | null {
  const origin = parseAllowedOrigins(corsOrigin)[0];
  if (!origin) {
    return null;
  }
  return buildWebOAuthRedirect(
    `${origin}${WEB_OAUTH_FALLBACK_PATH}`,
    corsOrigin,
    success,
  );
}
