import { createHash, randomBytes } from 'node:crypto';

/** 256 bits of entropy, URL-safe: the only credential the public link carries. */
const SHARE_TOKEN_BYTES = 32;

/** Hex characters kept per item reference; enough to be unique inside a share. */
const ITEM_REF_LENGTH = 16;

export function generateReceivableShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}

/**
 * Opaque per-item reference, stable across requests and derived from the share
 * so the public payload never exposes the receivable id.
 */
export function receivableShareItemRef(
  shareId: string,
  receivableId: string,
): string {
  return createHash('sha256')
    .update(`${shareId}:${receivableId}`)
    .digest('hex')
    .slice(0, ITEM_REF_LENGTH);
}
