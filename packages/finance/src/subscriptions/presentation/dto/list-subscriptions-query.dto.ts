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
import {
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_SORTS,
} from '../../domain/subscription-list';

export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELLED'] as const;

/** Accepts `?categoryIds=a,b` or a repeated parameter. */
function toIdList(value: unknown): string[] | undefined {
  const cleaned = idList(value).filter((id) => id.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

function idList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim());
  }
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim());
  }
  return [];
}

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

  @ApiPropertyOptional({
    description: 'Category ids, comma separated',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => toIdList(value))
  @IsUUID(undefined, { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ enum: SUBSCRIPTION_FREQUENCIES })
  @IsOptional()
  @IsIn(SUBSCRIPTION_FREQUENCIES)
  frequency?: (typeof SUBSCRIPTION_FREQUENCIES)[number];

  @ApiPropertyOptional({ enum: SUBSCRIPTION_SORTS, default: 'NEXT_DATE' })
  @IsOptional()
  @IsIn(SUBSCRIPTION_SORTS)
  sort?: (typeof SUBSCRIPTION_SORTS)[number];

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
