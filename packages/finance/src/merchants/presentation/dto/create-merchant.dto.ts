import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  MAX_MERCHANT_ALIASES,
  MAX_MERCHANT_ALIAS_LENGTH,
} from '../../domain/merchant-aliases';

export class CreateMerchantDto {
  @ApiProperty({ maxLength: 120, example: 'Supermercado Nacional' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_MERCHANT_ALIASES,
    description: 'Other names the merchant appears with',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MERCHANT_ALIASES)
  @IsString({ each: true })
  @MaxLength(MAX_MERCHANT_ALIAS_LENGTH, { each: true })
  aliases?: string[];
}
