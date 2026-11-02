import { ApiProperty } from '@nestjs/swagger';
import { RECEIVABLE_STATUSES } from '../../application/resolve-receivable-payment';

export class ReceivableResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  debtorName!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: '1500.00' })
  paidAmount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  dueDate!: string | null;

  @ApiProperty({ enum: RECEIVABLE_STATUSES })
  status!: string;

  @ApiProperty({ example: '0.00' })
  creditBalance!: string;

  @ApiProperty({ example: '0.00' })
  writtenOffAmount!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  writtenOffAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ReceivablePageResponseDto {
  @ApiProperty({ type: () => [ReceivableResponseDto] })
  items!: ReceivableResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class ReceivablePaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  receivableId!: string;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: '1500.00' })
  appliedAmount!: string;

  @ApiProperty({ example: '0.00' })
  excessAmount!: string;

  @ApiProperty({ nullable: true, type: String })
  excessHandling!: string | null;

  @ApiProperty({ format: 'date-time' })
  paidAt!: string;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transactionId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ReceivablePaymentPageResponseDto {
  @ApiProperty({ type: () => [ReceivablePaymentResponseDto] })
  items!: ReceivablePaymentResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
