import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class SpendingOverTimeQueryDto {
  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'day' })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  granularity?: 'day' | 'week' | 'month';
}
