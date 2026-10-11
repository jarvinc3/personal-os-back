import { Injectable } from '@nestjs/common';
import {
  CursorPage,
  CursorQueryDto,
  clampPageLimit,
  toCursorPage,
} from './pagination.dto';

@Injectable()
export class PaginationService {
  limit(query: CursorQueryDto): number {
    return clampPageLimit(query.limit);
  }

  result<T extends { id: string }>(
    rows: T[],
    query: CursorQueryDto,
    keyOf: (row: T) => string,
  ): CursorPage<T> {
    return toCursorPage(rows, clampPageLimit(query.limit), keyOf);
  }
}
