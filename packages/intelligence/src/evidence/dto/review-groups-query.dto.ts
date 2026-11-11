import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  REVIEW_GROUPS_DEFAULT_PAGE_SIZE,
  REVIEW_GROUPS_MAX_PAGE_SIZE,
  REVIEW_GROUPS_ORDERS,
} from '../review-groups.constants';

export class ReviewGroupsQueryDto {
  @ApiPropertyOptional({ enum: REVIEW_GROUPS_ORDERS, default: 'IMPACT' })
  @IsOptional()
  @IsIn(REVIEW_GROUPS_ORDERS)
  order?: (typeof REVIEW_GROUPS_ORDERS)[number];

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    default: REVIEW_GROUPS_DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: REVIEW_GROUPS_MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REVIEW_GROUPS_MAX_PAGE_SIZE)
  pageSize?: number;
}
