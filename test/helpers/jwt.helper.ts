import jwt from 'jsonwebtoken';

type TestJwtOverrides = {
  sub?: string;
  email?: string;
  role?: string;
  expiresIn?: string | number;
};

export function createTestJwt(overrides: TestJwtOverrides = {}): string {
  const supabaseUrl = process.env.SUPABASE_URL ?? 'https://example.supabase.co';
  const issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;

  return jwt.sign(
    {
      sub: overrides.sub ?? 'test-user-id',
      email: overrides.email ?? 'test@example.com',
      role: overrides.role ?? 'authenticated',
      aud: 'authenticated',
      iss: issuer,
    },
    'test-secret',
    {
      algorithm: 'HS256',
      expiresIn: overrides.expiresIn ?? '1h',
    },
  );
}
