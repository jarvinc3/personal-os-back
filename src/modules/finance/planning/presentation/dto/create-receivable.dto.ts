import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsDateString,
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
} from 'class-validator';
import { CurrencyField } from '../../../shared/presentation/validation.decorators';

export class CreateReceivableDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  debtorName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @ApiPropertyOptional({ default: 'DOP', example: 'DOP' })
  @CurrencyField()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
