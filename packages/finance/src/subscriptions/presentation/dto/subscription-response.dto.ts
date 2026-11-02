import { ApiProperty } from '@nestjs/swagger';
import { BILLING_CYCLES } from '../../domain/billing';
import { SUBSCRIPTION_ALERT_KINDS } from '../../domain/subscription-alerts';
import { SUBSCRIPTION_BREAKDOWNS } from './subscription-breakdown-query.dto';
import { SUBSCRIPTION_STATUSES } from './list-subscriptions-query.dto';

const SUBSCRIPTION_PAYMENT_SOURCES = ['AUTO', 'MANUAL'] as const;
const PAYMENT_METHOD_TYPES = ['CARD', 'ACCOUNT'] as const;
const TREND_DIRECTIONS = ['up', 'down', 'flat'] as const;

export class PaymentMethodResponseDto {
  @ApiProperty({ enum: PAYMENT_METHOD_TYPES })
  type!: string;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  institution!: string | null;

  @ApiProperty({ nullable: true, type: String })
  last4!: string | null;

  @ApiProperty({ nullable: true, type: String })
  logoUrl!: string | null;
}

export class SubscriptionCategoryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  icon!: string | null;

  @ApiProperty({ nullable: true, type: String })
  color!: string | null;
}

export class SubscriptionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  normalizedKey!: string;

  @ApiProperty({ nullable: true, type: String })
  domain!: string | null;

  @ApiProperty({ nullable: true, type: String })
  logoUrl!: string | null;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ enum: BILLING_CYCLES })
  billingCycle!: string;

  @ApiProperty()
  billingInterval!: number;

  @ApiProperty({ format: 'date' })
  anchorDate!: string;

  @ApiProperty({ format: 'date' })
  nextBillingDate!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date' })
  trialEndsAt!: string | null;

  @ApiProperty({ enum: SUBSCRIPTION_STATUSES })
  status!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  pausedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  cancelledAt!: string | null;

  @ApiProperty()
  reminderDaysBefore!: number;

  @ApiProperty()
  lastChargeMismatch!: boolean;

  @ApiProperty({ nullable: true, type: String, example: '1500.00' })
  lastPaymentAmount!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date' })
  lastRemindedFor!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  accountName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({ type: () => SubscriptionCategoryResponseDto, nullable: true })
  category!: SubscriptionCategoryResponseDto | null;

  @ApiProperty({ type: () => PaymentMethodResponseDto, nullable: true })
  paymentMethod!: PaymentMethodResponseDto | null;

  @ApiProperty({ nullable: true, type: String })
  manageUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;

  @ApiProperty({ nullable: true, type: String })
  sourcePatternId!: string | null;

  @ApiProperty({ example: '125.00' })
  monthlyEquivalent!: string;

  @ApiProperty({ example: '1500.00' })
  annualEquivalent!: string;

  @ApiProperty()
  daysUntil!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class SubscriptionPageResponseDto {
  @ApiProperty({ type: () => [SubscriptionResponseDto] })
  items!: SubscriptionResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class SubscriptionCurrencyCostResponseDto {
  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ example: '125.00' })
  monthlyCost!: string;

  @ApiProperty({ example: '1500.00' })
  annualCost!: string;

  @ApiProperty()
  activeCount!: number;
}

export class SubscriptionTrendResponseDto {
  @ApiProperty({ enum: TREND_DIRECTIONS })
  direction!: string;

  @ApiProperty()
  percent!: number;
}

export class SubscriptionSummaryResponseDto {
  @ApiProperty({ example: 'DOP' })
  baseCurrency!: string;

  @ApiProperty()
  activeCount!: number;

  @ApiProperty({ example: '125.00' })
  monthlyCost!: string;

  @ApiProperty({ example: '1500.00' })
  annualCost!: string;

  @ApiProperty({ type: () => [SubscriptionCurrencyCostResponseDto] })
  byCurrency!: SubscriptionCurrencyCostResponseDto[];

  @ApiProperty({ example: '125.00' })
  previousMonthlyCost!: string;

  @ApiProperty({ example: '125.00' })
  realSpendThisMonth!: string;

  @ApiProperty({ example: '125.00' })
  realSpendPreviousMonth!: string;

  @ApiProperty({ type: () => SubscriptionTrendResponseDto, nullable: true })
  trend!: SubscriptionTrendResponseDto | null;

  @ApiProperty()
  pendingDetectedCount!: number;

  @ApiProperty({ example: '0.00' })
  cancelledAnnualSavings!: string;

  @ApiProperty()
  reminderWindowDays!: number;

  @ApiProperty({ type: () => [SubscriptionResponseDto] })
  upcoming!: SubscriptionResponseDto[];
}

export class SubscriptionBreakdownItemResponseDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ nullable: true, type: String })
  color!: string | null;

  @ApiProperty()
  count!: number;

  @ApiProperty({ example: '125.00' })
  amount!: string;
}

export class SubscriptionBreakdownResponseDto {
  @ApiProperty({ example: 'DOP' })
  baseCurrency!: string;

  @ApiProperty({ enum: SUBSCRIPTION_BREAKDOWNS })
  by!: string;

  @ApiProperty({ type: () => [SubscriptionBreakdownItemResponseDto] })
  items!: SubscriptionBreakdownItemResponseDto[];
}

export class SubscriptionUpcomingItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  subscriptionId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  logoUrl!: string | null;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ format: 'date' })
  date!: string;

  @ApiProperty()
  daysUntil!: number;

  @ApiProperty({ type: () => PaymentMethodResponseDto, nullable: true })
  paymentMethod!: PaymentMethodResponseDto | null;
}

export class SubscriptionUpcomingResponseDto {
  @ApiProperty({ format: 'date' })
  from!: string;

  @ApiProperty({ format: 'date' })
  to!: string;

  @ApiProperty({ type: () => [SubscriptionUpcomingItemResponseDto] })
  items!: SubscriptionUpcomingItemResponseDto[];
}

export class SubscriptionAlertResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: SUBSCRIPTION_ALERT_KINDS })
  kind!: string;

  @ApiProperty()
  subscriptionId!: string;

  @ApiProperty()
  subscriptionName!: string;

  @ApiProperty({ format: 'date' })
  date!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ nullable: true, type: String, example: '1500.00' })
  amount!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '1500.00' })
  previousAmount!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '1500.00' })
  expectedAmount!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  percent!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  daysUntil!: number | null;
}

export class SubscriptionPaymentTransactionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  merchant!: string | null;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ format: 'date-time' })
  transactionDate!: string;

  @ApiProperty({ nullable: true, type: String })
  accountName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardName!: string | null;
}

export class SubscriptionPaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ format: 'date-time' })
  paidAt!: string;

  @ApiProperty({ enum: SUBSCRIPTION_PAYMENT_SOURCES })
  source!: string;

  @ApiProperty({ nullable: true, type: String })
  transactionId!: string | null;

  @ApiProperty({
    type: () => SubscriptionPaymentTransactionResponseDto,
    nullable: true,
  })
  transaction!: SubscriptionPaymentTransactionResponseDto | null;
}

export class SubscriptionPaymentPageResponseDto {
  @ApiProperty({ type: () => [SubscriptionPaymentResponseDto] })
  items!: SubscriptionPaymentResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class SubscriptionManualPaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ format: 'date-time' })
  paidAt!: string;

  @ApiProperty({ enum: SUBSCRIPTION_PAYMENT_SOURCES })
  source!: string;
}

export class SubscriptionLogoResponseDto {
  @ApiProperty({ nullable: true, type: String })
  logoUrl!: string | null;
}

export class SubscriptionDismissedAlertsResponseDto {
  @ApiProperty()
  dismissed!: number;
}

export class SubscriptionDismissedAlertResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  dismissed!: boolean;
}
