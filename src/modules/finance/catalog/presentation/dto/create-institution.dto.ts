import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const INSTITUTION_TYPES = [
  'bank',
  'credit_union',
  'digital_wallet',
  'broker',
  'cash',
  'other',
] as const;

export class CreateInstitutionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @ApiPropertyOptional({ default: 'DO' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @ApiPropertyOptional({ enum: INSTITUTION_TYPES, default: 'bank' })
  @IsOptional()
  @IsIn(INSTITUTION_TYPES)
  type?: (typeof INSTITUTION_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  shortName?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Brand domain, for example bhd.com.do' })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  domain?: string | null;
}
