import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export type PageMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function paginationArgs(query: PaginationQueryDto): {
  skip: number;
  take: number;
} {
  const page = Math.max(1, query.page);
  const limit = Math.max(1, Math.min(100, query.limit));

  return {
    skip: (page - 1) * limit,
    take: limit,
  };
}

export function paginate<T>(
  items: T[],
  total: number,
  query: PaginationQueryDto,
): { items: T[]; pagination: PageMeta } {
  const page = Math.max(1, query.page);
  const limit = Math.max(1, Math.min(100, query.limit));
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
}
