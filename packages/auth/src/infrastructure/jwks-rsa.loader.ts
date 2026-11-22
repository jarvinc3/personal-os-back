import type { JwksClientOptions } from './jwks-client-options';

export type JwksClientInstance = {
  getSigningKey: (kid: string) => Promise<{ getPublicKey: () => string }>;
};

export type PassportJwksSecret = (
  req: unknown,
  rawJwtToken: string,
  done: (err: unknown, secret?: string) => void,
) => void;

type PassportJwtSecret = (options: JwksClientOptions) => PassportJwksSecret;

type JwksRsaModule = ((options: JwksClientOptions) => JwksClientInstance) & {
  passportJwtSecret: PassportJwtSecret;
};

function loadJwksRsa(): JwksRsaModule {
  // `jwks-rsa` loads as the module itself under CommonJS and as `default`
  // under ESM interop; support both without guessing at call sites.
  const loaded = require('jwks-rsa') as
    JwksRsaModule | { default: JwksRsaModule };

  if (typeof loaded === 'function') {
    return loaded;
  }

  if (typeof loaded.default === 'function') {
    return loaded.default;
  }

  throw new Error('Unable to load jwks-rsa module');
}

export function createJwksClient(
  options: JwksClientOptions,
): JwksClientInstance {
  return loadJwksRsa()(options);
}

export function createPassportJwksSecret(
  options: JwksClientOptions,
): PassportJwksSecret {
  return loadJwksRsa().passportJwtSecret(options);
}
