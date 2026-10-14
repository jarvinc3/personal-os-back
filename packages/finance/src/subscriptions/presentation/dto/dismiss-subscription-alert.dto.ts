import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsUUID } from 'class-validator';
import { SUBSCRIPTION_ALERT_KINDS } from '../../domain/subscription-alerts';

export class DismissSubscriptionAlertDto {
  @ApiProperty({ enum: SUBSCRIPTION_ALERT_KINDS })
  @IsIn(SUBSCRIPTION_ALERT_KINDS)
  kind!: (typeof SUBSCRIPTION_ALERT_KINDS)[number];

  @ApiProperty()
  @IsUUID()
  subscriptionId!: string;

  @ApiProperty({ description: 'Alert occurrence date (ISO date)' })
  @IsDateString()
  alertDate!: string;
}
