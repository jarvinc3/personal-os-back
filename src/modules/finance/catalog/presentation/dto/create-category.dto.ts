import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { FIN_CATEGORY_TYPES } from '../../../shared/domain/category-type';

export class CreateCategoryDto {
  @ApiProperty()
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiProperty({
    enum: FIN_CATEGORY_TYPES,
    default: 'EXPENSE',
    required: false,
    description: 'EXPENSE or INCOME. Defaults to EXPENSE when omitted.',
  })
  @IsOptional()
  @IsEnum(FIN_CATEGORY_TYPES)
  type?: (typeof FIN_CATEGORY_TYPES)[number];
}
