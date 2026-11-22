import type { SupabaseAuthConfig } from '@personal-os/config';
import { createPassportJwksSecret } from './jwks-rsa.loader';
import { createJwksSecretProvider } from './jwks-secret-provider';

jest.mock('./jwks-rsa.loader', () => ({
  createPassportJwksSecret: jest.fn(),
}));

const mockedCreatePassportJwksSecret =
  createPassportJwksSecret as jest.MockedFunction<
    typeof createPassportJwksSecret
  >;

function authConfig(): SupabaseAuthConfig {
  return {
    supabaseUrl: 'https://project.supabase.co',
    issuer: 'https://project.supabase.co/auth/v1',
    jwksUri: 'https://project.supabase.co/auth/v1/.well-known/jwks.json',
    audience: 'authenticated',
  };
}

describe('createJwksSecretProvider', () => {
  beforeEach(() => {
    mockedCreatePassportJwksSecret.mockClear();
  });

  it('creates the passport secret with the shared JWKS options', () => {
    mockedCreatePassportJwksSecret.mockReturnValue(jest.fn());

    createJwksSecretProvider(authConfig());

    expect(mockedCreatePassportJwksSecret).toHaveBeenCalledWith({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      jwksUri: 'https://project.supabase.co/auth/v1/.well-known/jwks.json',
    });
  });
});
