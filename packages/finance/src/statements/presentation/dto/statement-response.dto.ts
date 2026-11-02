import { ApiProperty } from '@nestjs/swagger';

const CARD_STATEMENT_STATUSES = [
  'OPEN',
  'CLOSED',
  'PARTIAL',
  'MINIMUM_PAID',
  'PAID',
  'OVERDUE',
] as const;
const AMOUNT_SOURCES = ['IMPORTED', 'ESTIMATED', 'MANUAL'] as const;
const TRANSACTION_TYPES = [
  'DEBIT',
  'CREDIT',
  'TRANSFER',
  'ADJUSTMENT',
  'CARD_PAYMENT',
] as const;
const TRANSACTION_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'DECLINED',
  'REVERSED',
] as const;
const TRANSACTION_SOURCES = ['MANUAL', 'EMAIL', 'AI'] as const;
const OPERATION_LEG_ROLES = ['SOURCE', 'DESTINATION', 'FEE'] as const;
const TRANSFER_RAILS = ['SAME_BANK', 'ACH', 'LBTR', 'OTHER'] as const;
const STATEMENT_LINE_TYPES = ['DEBIT', 'CREDIT'] as const;
const STATEMENT_LINE_DECISIONS = ['MATCH', 'CREATE', 'IGNORE'] as const;
const STATEMENT_IMPORT_STATUSES = [
  'PARSING',
  'READY',
  'APPLIED',
  'FAILED',
  'DISCARDED',
] as const;
const STATEMENT_TARGET_KINDS = ['CARD', 'ACCOUNT'] as const;

/** Transaction row as the statement detail returns it. */
export class StatementTransactionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardId!: string | null;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  importReference!: string | null;

  @ApiProperty({ nullable: true, type: String })
  externalReference!: string | null;

  @ApiProperty({ nullable: true, type: String })
  institutionId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  possibleDuplicateOfId!: string | null;

  @ApiProperty({ enum: TRANSACTION_TYPES })
  type!: string;

  /** Decimal as text: the API never sends money as a JSON number. */
  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: '1500.00' })
  ledgerAmount!: string;

  @ApiProperty({ example: '1500.00' })
  amountBaseCurrency!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ example: 'DOP' })
  ledgerCurrency!: string;

  @ApiProperty({ example: '1' })
  exchangeRate!: string;

  @ApiProperty()
  isEstimated!: boolean;

  @ApiProperty({ nullable: true, type: String })
  merchant!: string | null;

  @ApiProperty({ nullable: true, type: String })
  merchantId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ format: 'date-time' })
  transactionDate!: string;

  @ApiProperty({ nullable: true, type: String })
  transferGroupId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  linkedTransactionId!: string | null;

  @ApiProperty({ enum: TRANSACTION_STATUSES })
  status!: string;

  @ApiProperty()
  isRecurring!: boolean;

  @ApiProperty({ type: Object })
  aiMetadata!: Record<string, unknown>;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;

  @ApiProperty({ enum: TRANSACTION_SOURCES })
  source!: string;

  @ApiProperty({ enum: OPERATION_LEG_ROLES, nullable: true })
  legRole!: string | null;

  @ApiProperty({ enum: TRANSFER_RAILS, nullable: true })
  rail!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CardStatementResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ format: 'date-time' })
  cycleStart!: string;

  @ApiProperty({ format: 'date-time' })
  cycleEnd!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  dueDate!: string | null;

  @ApiProperty({ example: '25000.00' })
  closingBalance!: string;

  @ApiProperty({ example: '2500.00' })
  minimumPayment!: string;

  @ApiProperty({ enum: AMOUNT_SOURCES, nullable: true })
  minimumSource!: string | null;

  @ApiProperty({ example: '0.00' })
  paidAmount!: string;

  @ApiProperty({ example: '25000.00' })
  remaining!: string;

  @ApiProperty({ enum: CARD_STATEMENT_STATUSES })
  status!: string;
}

export class CardStatementPageResponseDto {
  @ApiProperty({ type: () => [CardStatementResponseDto] })
  items!: CardStatementResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class CardStatementDetailResponseDto {
  @ApiProperty({ type: () => CardStatementResponseDto })
  statement!: CardStatementResponseDto;

  @ApiProperty({ type: () => [StatementTransactionResponseDto] })
  movements!: StatementTransactionResponseDto[];

  @ApiProperty({ type: () => [StatementTransactionResponseDto] })
  payments!: StatementTransactionResponseDto[];
}

export class StatementImportTargetResponseDto {
  @ApiProperty({ enum: STATEMENT_TARGET_KINDS })
  kind!: string;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;
}

export class StatementImportHeaderResponseDto {
  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date' })
  periodStart!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date' })
  periodEnd!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date' })
  dueDate!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '1000.00' })
  previousBalance!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '2500.00' })
  closingBalance!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '250.00' })
  minimumPayment!: string | null;
}

export class StatementImportPeriodResponseDto {
  @ApiProperty({ format: 'date-time' })
  from!: string;

  @ApiProperty({ format: 'date-time' })
  to!: string;
}

export class StatementImportCountsResponseDto {
  @ApiProperty()
  lines!: number;

  @ApiProperty()
  matched!: number;

  @ApiProperty()
  missing!: number;

  @ApiProperty()
  extra!: number;
}

export class StatementImportLineResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'date' })
  date!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ example: '150.00' })
  amount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ enum: STATEMENT_LINE_TYPES })
  type!: string;

  @ApiProperty({ nullable: true, type: String })
  reference!: string | null;

  @ApiProperty({ enum: STATEMENT_LINE_DECISIONS })
  decision!: string;

  @ApiProperty({ nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  categoryName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transactionId!: string | null;
}

export class StatementImportExtraResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'date-time' })
  date!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ nullable: true, type: String })
  merchant!: string | null;

  @ApiProperty({ example: '150.00' })
  amount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ enum: TRANSACTION_TYPES })
  type!: string;
}

export class StatementImportAdjustmentResponseDto {
  @ApiProperty({ example: '150.00' })
  amount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;
}

export class StatementImportResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: STATEMENT_IMPORT_STATUSES })
  status!: string;

  @ApiProperty({ nullable: true, type: String })
  error!: string | null;

  @ApiProperty({ nullable: true, type: String })
  failureReason!: string | null;

  @ApiProperty({ type: () => StatementImportTargetResponseDto })
  target!: StatementImportTargetResponseDto;

  @ApiProperty({ type: () => StatementImportHeaderResponseDto })
  header!: StatementImportHeaderResponseDto;

  @ApiProperty({
    nullable: true,
    type: () => StatementImportPeriodResponseDto,
  })
  period!: StatementImportPeriodResponseDto | null;

  @ApiProperty({ type: () => StatementImportCountsResponseDto })
  counts!: StatementImportCountsResponseDto;

  @ApiProperty({ type: () => [StatementImportLineResponseDto] })
  lines!: StatementImportLineResponseDto[];

  @ApiProperty({ type: () => [StatementImportExtraResponseDto] })
  extra!: StatementImportExtraResponseDto[];

  @ApiProperty({ nullable: true, type: String, example: '0.00' })
  difference!: string | null;

  @ApiProperty({
    nullable: true,
    type: () => StatementImportAdjustmentResponseDto,
  })
  adjustment!: StatementImportAdjustmentResponseDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  appliedAt!: string | null;
}

export class StatementImportCreatedResponseDto {
  @ApiProperty()
  importId!: string;
}
