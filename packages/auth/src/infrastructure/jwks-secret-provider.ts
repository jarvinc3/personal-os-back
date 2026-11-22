import type { SupabaseAuthConfig } from '@personal-os/config';
import { buildJwksClientOptions } from './jwks-client-options';
import {
  createPassportJwksSecret,
  type PassportJwksSecret,
} from './jwks-rsa.loader';

export function createJwksSecretProvider(
  authConfig: SupabaseAuthConfig,
): PassportJwksSecret {
  return createPassportJwksSecret(buildJwksClientOptions(authConfig));
}
