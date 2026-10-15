import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export class CursorQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit = DEFAULT_PAGE_LIMIT;
}

export type CursorPoint = {
  key: string;
  id: string;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export function clampPageLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(MAX_PAGE_LIMIT, limit ?? DEFAULT_PAGE_LIMIT));
}

export function encodeCursor(point: CursorPoint): string {
  return Buffer.from(JSON.stringify(point), 'utf8').toString('base64url');
}

const INVALID_CURSOR_MESSAGE = 'Cursor inválido';

/**
 * `isValidKey` defaults to a timestamp check: almost every list orders by a
 * date, so a key that does not parse as one is a forged cursor. A list that
 * orders by another column passes its own check.
 */
export function decodeCursor(
  cursor: string,
  isValidKey: (key: string) => boolean = isTimestampKey,
): CursorPoint {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch (error) {
    throw new BadRequestException(INVALID_CURSOR_MESSAGE, { cause: error });
  }
  if (!isCursorPoint(parsed)) {
    throw new BadRequestException(INVALID_CURSOR_MESSAGE);
  }
  if (!isValidKey(parsed.key)) {
    throw new BadRequestException(INVALID_CURSOR_MESSAGE);
  }
  return parsed;
}

function isTimestampKey(key: string): boolean {
  return !Number.isNaN(Date.parse(key));
}

function isCursorPoint(value: unknown): value is CursorPoint {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const point = value as Partial<CursorPoint>;
  return typeof point.key === 'string' && typeof point.id === 'string';
}

export function toCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    hasMore,
    nextCursor:
      hasMore && last ? encodeCursor({ key: keyOf(last), id: last.id }) : null,
  };
}
