import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  REVIEW_GROUPS_DEFAULT_PAGE_SIZE,
  REVIEW_GROUPS_MAX_PAGE_SIZE,
} from '../review-groups.constants';

export class ReviewGroupsQueryDto {
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
