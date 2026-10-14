import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Only subscriptions without a category' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unassignedCategory?: boolean;

  @ApiPropertyOptional({
    description: 'Only subscriptions without a card or account',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unassignedMethod?: boolean;

  @ApiPropertyOptional({ description: 'Name search' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
