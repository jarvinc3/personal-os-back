import { decodeCursor } from '@personal-os/core';
import type { CursorPoint } from '@personal-os/core';

/**
 * Order position of the last row of a cursor page, or null on the first page.
 * The cursor stays opaque; only the repositories unpack it.
 */
export function decodeCursorPosition(
  cursor: string | undefined,
): { date: Date; id: string } | null {
  if (!cursor) {
    return null;
  }
  const point = decodeCursor(cursor);
  return { date: new Date(point.key), id: point.id };
}

/**
 * Same idea for a list ordered by a text column instead of a timestamp. The
 * caller parses `key`; the base validator is skipped on purpose.
 */
export function decodeCursorKeyPosition(
  cursor: string | undefined,
): CursorPoint | null {
  if (!cursor) {
    return null;
  }
  return decodeCursor(cursor, () => true);
}
