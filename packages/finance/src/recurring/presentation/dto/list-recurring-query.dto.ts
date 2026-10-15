import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CursorQueryDto } from '@personal-os/core';
import { DEFAULT_UPCOMING_DAYS } from '../../domain/recurring-alerts';

export class ListRecurringQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: ['SUGGESTED', 'CONFIRMED', 'DISMISSED'] })
  @IsOptional()
  @IsIn(['SUGGESTED', 'CONFIRMED', 'DISMISSED'])
  status?: 'SUGGESTED' | 'CONFIRMED' | 'DISMISSED';
}

export class UpcomingRecurringQueryDto {
  @ApiPropertyOptional({ default: DEFAULT_UPCOMING_DAYS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = DEFAULT_UPCOMING_DAYS;
}
