import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorQueryDto } from '@personal-os/core';

export class ListMerchantsQueryDto extends CursorQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Start of the spend window (ISO date)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'End of the spend window (ISO date)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
