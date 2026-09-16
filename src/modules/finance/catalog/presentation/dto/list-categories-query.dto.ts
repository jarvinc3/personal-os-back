import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { FIN_CATEGORY_TYPES } from '../../../shared/domain/category-type';

export class ListCategoriesQueryDto {
  @ApiPropertyOptional({ enum: FIN_CATEGORY_TYPES })
  @IsOptional()
  @IsEnum(FIN_CATEGORY_TYPES)
  type?: (typeof FIN_CATEGORY_TYPES)[number];
}
