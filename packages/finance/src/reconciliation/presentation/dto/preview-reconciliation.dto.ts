import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsUUID } from 'class-validator';
import { CurrencyField } from '../../../shared/presentation/validation.decorators';

export class PreviewReconciliationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @ApiPropertyOptional({ example: 'DOP' })
  @CurrencyField()
  currency?: string;

  @ApiProperty({ description: 'Cut-off date (ISO date), defaults to today' })
  @IsDateString()
  asOfDate!: string;

  @ApiProperty({ description: 'Balance shown by the bank app' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  realBalance!: number;
}
