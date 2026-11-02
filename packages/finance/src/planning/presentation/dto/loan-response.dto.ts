import { ApiProperty } from '@nestjs/swagger';

const INSTALLMENT_FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;
const RATE_TYPES = ['FIXED', 'VARIABLE'] as const;
const INSTALLMENT_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'] as const;
const PREPAYMENT_MODES = ['REDUCE_TERM', 'REDUCE_PAYMENT'] as const;

export class LoanReferenceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class LoanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ nullable: true, type: String })
  institutionId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty()
  lenderName!: string;

  /** Decimal as text: the API never sends money as a JSON number. */
  @ApiProperty({ example: '100000.00' })
  originalAmount!: string;

  @ApiProperty({ example: '75000.00' })
  currentBalance!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ example: '8500.00' })
  installmentAmount!: string;

  @ApiProperty({ enum: INSTALLMENT_FREQUENCIES })
  installmentFreq!: string;

  @ApiProperty()
  totalInstallments!: number;

  @ApiProperty()
  paidInstallments!: number;

  @ApiProperty({ format: 'date-time' })
  nextDueDate!: string;

  @ApiProperty({ nullable: true, type: String, example: '0.1800' })
  interestRate!: string | null;

  @ApiProperty({ enum: RATE_TYPES })
  rateType!: string;

  @ApiProperty({ nullable: true, type: String, example: '500.00' })
  insuranceAmount!: string | null;

  @ApiProperty({ nullable: true, type: Object })
  lateFeePolicy!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: String, example: '0.0200' })
  prepaymentPenaltyPct!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  disbursementDate!: string | null;

  @ApiProperty({ nullable: true, type: String })
  disbursementAccountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  disbursementTransactionId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ nullable: true, type: () => LoanReferenceDto })
  account!: LoanReferenceDto | null;

  @ApiProperty({ nullable: true, type: () => LoanReferenceDto })
  disbursementAccount!: LoanReferenceDto | null;

  @ApiProperty({ nullable: true, type: () => LoanReferenceDto })
  institution!: LoanReferenceDto | null;
}

export class LoanPageResponseDto {
  @ApiProperty({ type: () => [LoanResponseDto] })
  items!: LoanResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class LoanInstallmentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  loanId!: string;

  @ApiProperty()
  installmentNo!: number;

  @ApiProperty({ format: 'date-time' })
  dueDate!: string;

  @ApiProperty({ example: '8500.00' })
  amount!: string;

  @ApiProperty({ example: '7000.00' })
  principal!: string;

  @ApiProperty({ example: '1500.00' })
  interest!: string;

  @ApiProperty({ example: '0.00' })
  insurance!: string;

  @ApiProperty({ example: '0.00' })
  fees!: string;

  @ApiProperty({ example: '0.00' })
  lateFee!: string;

  @ApiProperty({ example: '0.00' })
  paidAmount!: string;

  @ApiProperty({ enum: INSTALLMENT_STATUSES })
  status!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  paidAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transactionId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class LoanInstallmentPageResponseDto {
  @ApiProperty({ type: () => [LoanInstallmentResponseDto] })
  items!: LoanInstallmentResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class LoanPaymentBreakdownDto {
  @ApiProperty({ example: '0.00' })
  lateFee!: number;

  @ApiProperty({ example: '0.00' })
  fees!: number;

  @ApiProperty({ example: '0.00' })
  insurance!: number;

  @ApiProperty({ example: '1500.00' })
  interest!: number;

  @ApiProperty({ example: '7000.00' })
  principal!: number;

  @ApiProperty({ example: '8500.00' })
  applied!: number;
}

export class LoanInstallmentPaymentResponseDto {
  @ApiProperty()
  installmentNo!: number;

  @ApiProperty({ type: () => LoanPaymentBreakdownDto })
  breakdown!: LoanPaymentBreakdownDto;

  @ApiProperty({ example: '8500.00' })
  paidAmount!: number;

  @ApiProperty({ enum: ['PAID', 'PARTIAL'] })
  status!: string;

  @ApiProperty({ example: '66500.00' })
  currentBalance!: number;
}

export class LoanPrepaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  loanId!: string;

  @ApiProperty({ example: '5000.00' })
  amount!: string;

  @ApiProperty({ example: '100.00' })
  penalty!: string;

  @ApiProperty({ enum: PREPAYMENT_MODES })
  mode!: string;

  @ApiProperty({ format: 'date-time' })
  paidAt!: string;

  @ApiProperty({ nullable: true, type: String })
  transactionId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class LoanPrepaymentResultResponseDto {
  @ApiProperty({ type: () => LoanPrepaymentResponseDto })
  prepayment!: LoanPrepaymentResponseDto;

  @ApiProperty({ type: () => LoanResponseDto })
  loan!: LoanResponseDto;

  @ApiProperty({ type: () => [LoanInstallmentResponseDto] })
  schedulePreview!: LoanInstallmentResponseDto[];
}

export class LoanPrepaymentPreviewResponseDto {
  @ApiProperty({ example: '70000.00' })
  newBalance!: number;

  @ApiProperty({ example: 10 })
  totalInstallments!: number;

  @ApiProperty({ example: '8200.00' })
  installmentAmount!: number;

  @ApiProperty({ example: '12000.00' })
  interestRemaining!: number;

  @ApiProperty({ format: 'date-time' })
  newEndDate!: string;
}
