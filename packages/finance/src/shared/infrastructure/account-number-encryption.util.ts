import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a bank account number with DATA_ENCRYPTION_KEY. Same AES-256-GCM
 * construction as the Gmail token helper (`token-encryption.util.ts`), but a
 * different key: that one only protects OAuth tokens.
 */
export function encryptAccountNumber(
  plaintext: string,
  secret: string,
): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptAccountNumber(
  ciphertext: string,
  secret: string,
): string {
  const buffer = Buffer.from(ciphertext, 'base64');
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  try {
    const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new Error('Account number could not be decrypted', { cause: error });
  }
}

/**
 * HMAC-SHA256 blind index. The random IV makes equal account numbers produce
 * different ciphertext, so the unique index checks this fingerprint instead.
 */
export function fingerprintAccountNumber(
  plaintext: string,
  secret: string,
): string {
  return createHmac('sha256', deriveKey(secret))
    .update(plaintext)
    .digest('hex');
}

export function accountNumberLast4(plaintext: string): string {
  return plaintext.slice(-4);
}
