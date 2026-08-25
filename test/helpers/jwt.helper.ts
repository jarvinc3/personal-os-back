import jwt from 'jsonwebtoken';
import { TEST_JWT_SECRET } from './auth-test.providers';

type TestJwtOverrides = {
  sub?: string;
  email?: string;
  role?: string;
  expiresIn?: number;
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
    TEST_JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: overrides.expiresIn ?? 3600,
    },
  );
}
