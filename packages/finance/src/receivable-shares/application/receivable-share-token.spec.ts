import {
  generateReceivableShareToken,
  receivableShareItemRef,
} from './receivable-share-token';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe('generateReceivableShareToken', () => {
  it('returns a URL-safe token with at least 32 bytes of entropy', () => {
    const token = generateReceivableShareToken();

    expect(token).toMatch(BASE64URL);
    expect(Buffer.from(token, 'base64url').byteLength).toBeGreaterThanOrEqual(
      32,
    );
  });

  it('never repeats a token', () => {
    const tokens = new Set(
      Array.from({ length: 20 }, () => generateReceivableShareToken()),
    );

    expect(tokens.size).toBe(20);
  });
});

describe('receivableShareItemRef', () => {
  it('is stable for the same share and receivable', () => {
    expect(receivableShareItemRef('share-1', 'rec-1')).toBe(
      receivableShareItemRef('share-1', 'rec-1'),
    );
  });

  it('does not expose the receivable id', () => {
    const ref = receivableShareItemRef('share-1', 'rec-1');

    expect(ref).not.toContain('rec-1');
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs per receivable inside one share', () => {
    expect(receivableShareItemRef('share-1', 'rec-1')).not.toBe(
      receivableShareItemRef('share-1', 'rec-2'),
    );
  });
});
