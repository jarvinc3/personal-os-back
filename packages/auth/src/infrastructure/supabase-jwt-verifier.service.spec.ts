import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('SupabaseJwtVerifierService (production path)', () => {
  it('does not short-circuit verification for NODE_ENV=test', () => {
    const source = readFileSync(
      join(__dirname, 'supabase-jwt-verifier.service.ts'),
      'utf8',
    );

    expect(source).not.toContain('test-secret');
    expect(source).not.toContain("nodeEnv === 'test'");
    expect(source).not.toContain("NODE_ENV');");
    expect(source).not.toContain('test-user');
    expect(source).toContain('createJwksClient');
    expect(source).toContain('SUPPORTED_JWT_ALGORITHMS');
  });
});
