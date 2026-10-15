import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CreateSubscriptionDto } from './create-subscription.dto';

const SUBSCRIPTION_UPDATE_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELLED'] as const;

export class UpdateSubscriptionDto extends PartialType(CreateSubscriptionDto) {
  @ApiPropertyOptional({ enum: SUBSCRIPTION_UPDATE_STATUSES })
  @IsOptional()
  @IsIn(SUBSCRIPTION_UPDATE_STATUSES)
  status?: (typeof SUBSCRIPTION_UPDATE_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Last date already reminded' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDaysBefore?: number;
}
