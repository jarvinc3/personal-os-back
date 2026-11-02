import { ApiProperty } from '@nestjs/swagger';

const RECURRING_STATUSES = ['SUGGESTED', 'CONFIRMED', 'DISMISSED'] as const;
const RECURRING_KINDS = ['SUBSCRIPTION', 'BILL', 'INCOME', 'OTHER'] as const;

export class RecurringPatternResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  merchantId!: string | null;

  @ApiProperty()
  merchant!: string;

  @ApiProperty()
  merchantName!: string;

  @ApiProperty({ nullable: true, type: String })
  logoUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({ example: '1500.00' })
  avgAmount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ example: 30 })
  frequency!: number;

  @ApiProperty({ format: 'date' })
  nextExpectedDate!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastSeenAt!: string | null;

  @ApiProperty({ enum: RECURRING_STATUSES })
  status!: string;

  @ApiProperty({ enum: RECURRING_KINDS })
  kind!: string;

  @ApiProperty()
  confidenceScore!: number;

  @ApiProperty()
  amountTolerancePct!: number;

  @ApiProperty({ example: '125.00' })
  monthlyEquivalent!: string;

  @ApiProperty({ example: '1500.00' })
  annualEquivalent!: string;

  @ApiProperty()
  daysUntil!: number;
}

export class RecurringPageResponseDto {
  @ApiProperty({ type: () => [RecurringPatternResponseDto] })
  items!: RecurringPatternResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
