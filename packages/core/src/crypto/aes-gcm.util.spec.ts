import { decryptSecret, deriveSecretKey, encryptSecret } from './aes-gcm.util';

describe('cifrado AES-256-GCM', () => {
  const secret = 'test-data-encryption-key-minimum-32-chars!!';

  it('descifra lo que cifró', () => {
    const ciphertext = encryptSecret('001122335678', secret);

    expect(decryptSecret(ciphertext, secret)).toBe('001122335678');
  });

  it('cifra distinto cada vez por el IV aleatorio', () => {
    const first = encryptSecret('001122335678', secret);
    const second = encryptSecret('001122335678', secret);

    expect(first).not.toBe(second);
  });

  it('falla con otra clave o con un texto cifrado incompleto', () => {
    const ciphertext = encryptSecret('001122335678', secret);

    expect(() => decryptSecret(ciphertext, 'another-secret')).toThrow();
    expect(() => decryptSecret('c2hvcnQ=', secret)).toThrow(
      'Invalid encrypted value',
    );
  });

  it('deriva siempre la misma clave del secreto', () => {
    expect(deriveSecretKey(secret)).toHaveLength(32);
    expect(deriveSecretKey(secret)).toEqual(deriveSecretKey(secret));
    expect(deriveSecretKey(secret)).not.toEqual(deriveSecretKey('otro'));
  });
});
