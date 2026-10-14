import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SuggestMerchantQueryDto {
  @ApiPropertyOptional({ description: 'Raw merchant text typed by the user' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  merchant?: string;
}
