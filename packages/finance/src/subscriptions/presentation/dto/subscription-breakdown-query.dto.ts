import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const SUBSCRIPTION_BREAKDOWNS = [
  'category',
  'instrument',
  'currency',
] as const;

export type SubscriptionBreakdown = (typeof SUBSCRIPTION_BREAKDOWNS)[number];

export class SubscriptionBreakdownQueryDto {
  @ApiPropertyOptional({ enum: SUBSCRIPTION_BREAKDOWNS, default: 'category' })
  @IsOptional()
  @IsIn(SUBSCRIPTION_BREAKDOWNS)
  by?: SubscriptionBreakdown;
}
