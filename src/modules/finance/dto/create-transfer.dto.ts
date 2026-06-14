import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const transactionStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;

export class CreateTransferDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fromAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fromCardId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  toCardId?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  amount!: number;

  @ApiPropertyOptional({ default: 'DOP' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiProperty()
  @IsDateString()
  transactionDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ enum: transactionStatuses, default: 'CONFIRMED' })
  @IsOptional()
  @IsEnum(transactionStatuses)
  status?: (typeof transactionStatuses)[number];
}
