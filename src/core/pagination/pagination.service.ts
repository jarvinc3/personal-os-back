import { Injectable } from '@nestjs/common';
import {
  PageMeta,
  PaginationQueryDto,
  paginate,
  paginationArgs,
} from './pagination.dto';

@Injectable()
export class PaginationService {
  args(query: PaginationQueryDto): { skip: number; take: number } {
    return paginationArgs(query);
  }

  result<T>(
    items: T[],
    total: number,
    query: PaginationQueryDto,
  ): { items: T[]; pagination: PageMeta } {
    return paginate(items, total, query);
  }
}
