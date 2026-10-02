type JwksClientOptions = {
  cache: boolean;
  rateLimit: boolean;
  jwksRequestsPerMinute: number;
  jwksUri: string;
};

export type JwksClientInstance = {
  getSigningKey: (kid: string) => Promise<{ getPublicKey: () => string }>;
};

type PassportJwtSecret = (
  options: JwksClientOptions,
) => (
  req: unknown,
  rawJwtToken: string,
  done: (err: unknown, secret?: string) => void,
) => void;

type JwksRsaModule = ((options: JwksClientOptions) => JwksClientInstance) & {
  passportJwtSecret: PassportJwtSecret;
};

function loadJwksRsa(): JwksRsaModule {
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

export function createPassportJwksSecret(options: JwksClientOptions) {
  return loadJwksRsa().passportJwtSecret(options);
}
