import { ApiProperty } from '@nestjs/swagger';
import { RECONCILIATION_ADJUSTMENT_KINDS } from '../../domain/reconciliation-adjustment';

const RECONCILIATION_PRODUCT_KINDS = ['account', 'card'] as const;

export class ReconciliationAdjustmentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: RECONCILIATION_ADJUSTMENT_KINDS })
  kind!: string;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty()
  transactionId!: string;
}

export class ReconciliationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardId!: string | null;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ format: 'date', example: '2026-11-01' })
  asOfDate!: string;

  @ApiProperty({ example: '1500.00' })
  appBalance!: string;

  @ApiProperty({ example: '1500.00' })
  realBalance!: string;

  @ApiProperty({ example: '0.00' })
  difference!: string;

  @ApiProperty({ nullable: true, type: String })
  note!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: () => [ReconciliationAdjustmentResponseDto] })
  adjustments!: ReconciliationAdjustmentResponseDto[];
}

export class ReconciliationPageResponseDto {
  @ApiProperty({ type: () => [ReconciliationResponseDto] })
  items!: ReconciliationResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class SuggestedAdjustmentResponseDto {
  @ApiProperty({ enum: RECONCILIATION_ADJUSTMENT_KINDS })
  kind!: string;

  @ApiProperty({ example: '150.00' })
  amount!: string;
}

export class ReconciliationPreviewResponseDto {
  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardId!: string | null;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: '1500.00' })
  appBalance!: string;

  @ApiProperty({ example: '1500.00' })
  realBalance!: string;

  @ApiProperty({ example: '0.00' })
  difference!: string;

  @ApiProperty({ type: () => [SuggestedAdjustmentResponseDto] })
  suggestedAdjustments!: SuggestedAdjustmentResponseDto[];
}

export class ReconciliationStatusItemResponseDto {
  @ApiProperty()
  key!: string;

  @ApiProperty({ enum: RECONCILIATION_PRODUCT_KINDS })
  kind!: string;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardId!: string | null;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  institutionName!: string | null;

  @ApiProperty({ example: '1500.00' })
  balance!: string;

  @ApiProperty()
  reconciled!: boolean;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastReconciledAt!: string | null;
}

export class ReconciliationStatusResponseDto {
  @ApiProperty({ example: '2026-11' })
  month!: string;

  @ApiProperty({ type: () => [ReconciliationStatusItemResponseDto] })
  items!: ReconciliationStatusItemResponseDto[];

  @ApiProperty()
  reconciledCount!: number;

  @ApiProperty()
  pendingCount!: number;
}
