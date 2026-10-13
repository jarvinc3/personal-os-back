import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export class ApplyReceivableCreditDto {
  @ApiProperty()
  @IsUUID()
  targetReceivableId!: string;

  @ApiPropertyOptional({ description: 'Defaults to the whole credit balance' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
