import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Clave de 32 bytes derivada del secreto configurado. Es la derivación que ya
 * usan los datos guardados: cambiarla deja ilegible el ciphertext existente.
 */
export function deriveSecretKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** AES-256-GCM con `iv | tag | ciphertext` en base64. */
export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveSecretKey(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decryptSecret(ciphertext: string, secret: string): string {
  const buffer = Buffer.from(ciphertext, 'base64');
  if (buffer.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted value');
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    deriveSecretKey(secret),
    buffer.subarray(0, IV_LENGTH),
  );
  decipher.setAuthTag(buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH));
  return Buffer.concat([
    decipher.update(buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH)),
    decipher.final(),
  ]).toString('utf8');
}
