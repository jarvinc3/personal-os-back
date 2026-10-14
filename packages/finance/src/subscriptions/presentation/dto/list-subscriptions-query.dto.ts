import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorQueryDto } from '@personal-os/core';

export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELLED'] as const;

export class ListSubscriptionsQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: SUBSCRIPTION_STATUSES })
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES)
  status?: (typeof SUBSCRIPTION_STATUSES)[number];

  @ApiPropertyOptional({ description: 'ISO 4217 currency filter' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ description: 'Name search' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
