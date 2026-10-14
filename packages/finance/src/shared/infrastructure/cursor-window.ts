import { decodeCursor } from '@personal-os/core';

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
