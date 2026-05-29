import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

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
  @IsNumber()
  amount!: number;

  @ApiPropertyOptional({ default: 'DOP' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
