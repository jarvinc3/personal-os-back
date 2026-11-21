import {
  deriveSecretKey,
  decryptSecret,
  encryptSecret,
} from '@personal-os/core';
import { createHmac } from 'node:crypto';

/**
 * Encrypts a bank account number with DATA_ENCRYPTION_KEY using AES-256-GCM.
 */
export function encryptAccountNumber(
  plaintext: string,
  secret: string,
): string {
  return encryptSecret(plaintext, secret);
}

export function decryptAccountNumber(
  ciphertext: string,
  secret: string,
): string {
  try {
    return decryptSecret(ciphertext, secret);
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
  return createHmac('sha256', deriveSecretKey(secret))
    .update(plaintext)
    .digest('hex');
}

export function accountNumberLast4(plaintext: string): string {
  return plaintext.slice(-4);
}
