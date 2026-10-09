import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsUUID } from 'class-validator';
import { CurrencyField } from '../../../shared/presentation/validation.decorators';

export class AdjustBalanceDto {
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

  @ApiProperty({ description: 'Target balance after the adjustment' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  balance!: number;
}
