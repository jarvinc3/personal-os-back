import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpcomingSubscriptionsQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;

  @ApiPropertyOptional({ description: 'Window start (ISO date)' })
  @ValidateIf((query: UpcomingSubscriptionsQueryDto) => Boolean(query.to))
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Window end (ISO date)' })
  @ValidateIf((query: UpcomingSubscriptionsQueryDto) => Boolean(query.from))
  @IsDateString()
  to?: string;
}
