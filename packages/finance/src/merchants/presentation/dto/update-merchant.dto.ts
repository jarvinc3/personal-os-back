import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  MAX_MERCHANT_ALIASES,
  MAX_MERCHANT_ALIAS_LENGTH,
} from '../../domain/merchant-aliases';

export class UpdateMerchantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_MERCHANT_ALIASES,
    description: 'Complete alias list that replaces the current one',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MERCHANT_ALIASES)
  @IsString({ each: true })
  @MaxLength(MAX_MERCHANT_ALIAS_LENGTH, { each: true })
  aliases?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;
}
