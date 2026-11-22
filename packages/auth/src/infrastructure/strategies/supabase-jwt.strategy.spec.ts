import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('SupabaseJwtStrategy (production path)', () => {
  it('does not embed HS256 test-secret in production strategy source', () => {
    const source = readFileSync(
      join(__dirname, 'supabase-jwt.strategy.ts'),
      'utf8',
    );

    expect(source).not.toContain('test-secret');
    expect(source).not.toContain('NODE_ENV');
    expect(source).toContain('createJwksSecretProvider');
    expect(source).toContain('SUPPORTED_JWT_ALGORITHMS');
  });
});
