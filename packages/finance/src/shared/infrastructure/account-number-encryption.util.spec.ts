import {
  accountNumberLast4,
  decryptAccountNumber,
  encryptAccountNumber,
  fingerprintAccountNumber,
} from './account-number-encryption.util';

describe('account number encryption', () => {
  const secret = 'test-data-encryption-key-minimum-32-chars!!';

  it('round-trips an account number', () => {
    const ciphertext = encryptAccountNumber('001122335678', secret);

    expect(decryptAccountNumber(ciphertext, secret)).toBe('001122335678');
  });

  it('produces different ciphertext for the same number', () => {
    const first = encryptAccountNumber('001122335678', secret);
    const second = encryptAccountNumber('001122335678', secret);

    expect(first).not.toBe(second);
  });

  it('throws when the key is wrong', () => {
    const ciphertext = encryptAccountNumber('001122335678', secret);

    expect(() => decryptAccountNumber(ciphertext, 'another-secret')).toThrow(
      'Account number could not be decrypted',
    );
  });

  it('keeps the fingerprint stable and key-dependent', () => {
    const fingerprint = fingerprintAccountNumber('001122335678', secret);

    expect(fingerprintAccountNumber('001122335678', secret)).toBe(fingerprint);
    expect(fingerprintAccountNumber('001122335679', secret)).not.toBe(
      fingerprint,
    );
    expect(fingerprintAccountNumber('001122335678', 'another-secret')).not.toBe(
      fingerprint,
    );
  });

  it('returns the last four digits', () => {
    expect(accountNumberLast4('001122335678')).toBe('5678');
  });
});
