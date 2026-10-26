import {
  resolveNotificationsCorsOrigin,
  type NotificationsCorsOrigin,
} from './notifications-cors';

const PREVIEW_ORIGIN =
  'https://personal-os-web-git-fix-326-atajos-hero-c7ddee-collado-studios.vercel.app';
const PREVIEW_PATTERN =
  '^https://personal-os-web-git-[a-z0-9-]+-collado-studios\\.vercel\\.app$';

type CallbackResolver = (
  origin: string | undefined,
  callback: (error: Error | null, allowed?: boolean) => void,
) => void;

function asCallbackResolver(
  resolved: NotificationsCorsOrigin,
): CallbackResolver {
  if (typeof resolved !== 'function') {
    throw new Error('expected a callback resolver outside production');
  }
  return resolved;
}

describe('resolveNotificationsCorsOrigin', () => {
  const development = {
    corsOrigin: 'http://localhost:3000',
    previewPatterns: PREVIEW_PATTERN,
    isProduction: false,
  };

  it('allows the configured origin', () => {
    const resolve = asCallbackResolver(
      resolveNotificationsCorsOrigin(development),
    );
    const callback = jest.fn();

    resolve('http://localhost:3000', callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('allows a branch preview origin in development', () => {
    const resolve = asCallbackResolver(
      resolveNotificationsCorsOrigin(development),
    );
    const callback = jest.fn();

    resolve(PREVIEW_ORIGIN, callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('rejects a lookalike origin in development without an error', () => {
    const resolve = asCallbackResolver(
      resolveNotificationsCorsOrigin(development),
    );
    const callback = jest.fn();

    resolve(`${PREVIEW_ORIGIN}.evil.example`, callback);

    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('allows a handshake without Origin in development', () => {
    const resolve = asCallbackResolver(
      resolveNotificationsCorsOrigin(development),
    );
    const callback = jest.fn();

    resolve(undefined, callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('keeps the exact origin list in production and ignores patterns', () => {
    const singleOrigin = resolveNotificationsCorsOrigin({
      corsOrigin: 'https://app.example.com',
      previewPatterns: PREVIEW_PATTERN,
      isProduction: true,
    });
    const severalOrigins = resolveNotificationsCorsOrigin({
      corsOrigin: 'https://app.example.com, https://www.example.com',
      previewPatterns: PREVIEW_PATTERN,
      isProduction: true,
    });

    expect(singleOrigin).toBe('https://app.example.com');
    expect(severalOrigins).toEqual([
      'https://app.example.com',
      'https://www.example.com',
    ]);
  });

  it('disables CORS in production when no origin is configured', () => {
    const resolved = resolveNotificationsCorsOrigin({
      corsOrigin: undefined,
      previewPatterns: PREVIEW_PATTERN,
      isProduction: true,
    });

    expect(resolved).toBe(false);
  });
});
