import { decryptToken, encryptToken } from './token-encryption.util';

describe('AI Gmail token encryption', () => {
  it('encrypts tokens so the persisted value is not plaintext and decrypts them', () => {
    const token = 'gmail-refresh-token';
    const encrypted = encryptToken(token, 'dev-encryption-secret');

    expect(encrypted).not.toContain(token);
    expect(decryptToken(encrypted, 'dev-encryption-secret')).toBe(token);
  });

  it('rejects ciphertext when the encryption key differs', () => {
    const encrypted = encryptToken('gmail-access-token', 'secret-a');

    expect(() => decryptToken(encrypted, 'secret-b')).toThrow();
  });
});
