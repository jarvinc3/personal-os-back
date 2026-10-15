import { BadRequestException } from '@nestjs/common';
import {
  MAX_PAGE_LIMIT,
  clampPageLimit,
  decodeCursor,
  encodeCursor,
  toCursorPage,
} from './pagination.dto';

function forgeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('clampPageLimit', () => {
  it('falls back to the default when the limit is missing', () => {
    expect(clampPageLimit(undefined)).toBe(20);
  });

  it('clamps below 1 and above the maximum', () => {
    expect(clampPageLimit(0)).toBe(1);
    expect(clampPageLimit(MAX_PAGE_LIMIT + 1)).toBe(MAX_PAGE_LIMIT);
  });
});

describe('cursor encoding', () => {
  it('round-trips a point', () => {
    const point = { key: '2026-01-01T00:00:00.000Z', id: 'row-1' };

    expect(decodeCursor(encodeCursor(point))).toEqual(point);
  });

  it('rejects a cursor that is not base64 JSON', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(BadRequestException);
  });

  it('rejects a cursor with missing fields', () => {
    expect(() => decodeCursor(forgeCursor({ key: 'x' }))).toThrow(
      BadRequestException,
    );
  });

  it('rejects a cursor whose key is not a date', () => {
    expect(() =>
      decodeCursor(forgeCursor({ key: 'not-a-date', id: 'row-1' })),
    ).toThrow(BadRequestException);
  });

  it('accepts a custom key check for a list ordered by another column', () => {
    const cursor = encodeCursor({ key: '120.00', id: 'row-1' });
    const isAmountKey = (key: string) => /^\d+\.\d{2}$/.test(key);

    expect(decodeCursor(cursor, isAmountKey)).toEqual({
      key: '120.00',
      id: 'row-1',
    });
    expect(() => decodeCursor(cursor)).toThrow(BadRequestException);
    expect(() =>
      decodeCursor(forgeCursor({ key: 'oops', id: 'row-1' }), isAmountKey),
    ).toThrow(BadRequestException);
  });
});

describe('toCursorPage', () => {
  type Row = { id: string; at: string };
  const keyOf = (row: Row) => row.at;
  const rows: Row[] = [
    { id: 'b', at: '2026-02-01T00:00:00.000Z' },
    { id: 'a', at: '2026-01-01T00:00:00.000Z' },
  ];

  it('returns an empty page when there are no rows', () => {
    expect(toCursorPage([], 20, keyOf)).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('keeps one row for the cursor when an extra row means more', () => {
    const page = toCursorPage(rows, 1, keyOf);

    expect(page.items).toEqual([rows[0]]);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(String(page.nextCursor))).toEqual({
      key: rows[0].at,
      id: rows[0].id,
    });
  });

  it('returns the last page without a cursor', () => {
    const page = toCursorPage([rows[1]], 1, keyOf);

    expect(page.items).toEqual([rows[1]]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});
