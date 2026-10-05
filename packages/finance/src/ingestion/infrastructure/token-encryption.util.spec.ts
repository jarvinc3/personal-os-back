import { decryptToken, encryptToken } from './token-encryption.util';

describe('token encryption', () => {
  const secret = 'test-secret';

  it('round-trips a token', () => {
    expect(decryptToken(encryptToken('access-token', secret), secret)).toBe(
      'access-token',
    );
  });

  it('throws an actionable error when the key or ciphertext is wrong', () => {
    const ciphertext = encryptToken('access-token', secret);

    expect(() => decryptToken(ciphertext, 'another-secret')).toThrow(
      'Gmail tokens could not be decrypted. Reconnect the mailbox.',
    );
  });
});
