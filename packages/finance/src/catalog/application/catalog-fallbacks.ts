import { LogoService } from '@personal-os/logos';
import type { LogoRow } from '@personal-os/logos';
import { UsersService } from '@personal-os/users';

/**
 * Defaults for tests and for a module wired without logos or users. The casts
 * are the documented pending: they hide a dependency, they do not model it.
 */
export const fallbackLogos = {
  ensureLogo: () => Promise.resolve(null),
  resolveUrl: (row?: LogoRow | null) => row?.logoUrl ?? null,
  networkLogoUrl: () => null,
  saveCustomLogo: () => Promise.reject(new Error('Logo upload unavailable')),
} as unknown as LogoService;

export const fallbackUsers = {
  findById: () => Promise.resolve({ timezone: null }),
} as unknown as UsersService;
