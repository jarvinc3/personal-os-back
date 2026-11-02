import { ApiProperty } from '@nestjs/swagger';
import { RECEIVABLE_STATUSES } from '../../../planning/application/resolve-receivable-payment';

export class PublicShareCurrencyTotalResponseDto {
  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: '1500.00' })
  paid!: string;

  @ApiProperty({ example: '0.00' })
  pending!: string;
}

export class PublicSharePaymentResponseDto {
  @ApiProperty({ format: 'date-time' })
  paidAt!: string;

  @ApiProperty({ example: '1500.00' })
  amount!: string;
}

export class PublicShareItemResponseDto {
  @ApiProperty()
  ref!: string;

  @ApiProperty()
  concept!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  dueDate!: string | null;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: '1500.00' })
  paid!: string;

  @ApiProperty({ example: '0.00' })
  pending!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ enum: RECEIVABLE_STATUSES })
  status!: string;

  @ApiProperty({ nullable: true, type: String })
  note!: string | null;

  @ApiProperty({ type: () => [PublicSharePaymentResponseDto] })
  payments!: PublicSharePaymentResponseDto[];
}

export class PublicReceivableShareResponseDto {
  @ApiProperty()
  ownerFirstName!: string;

  @ApiProperty()
  debtorName!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: () => [PublicShareCurrencyTotalResponseDto] })
  totalsByCurrency!: PublicShareCurrencyTotalResponseDto[];

  @ApiProperty({ type: () => [PublicShareItemResponseDto] })
  items!: PublicShareItemResponseDto[];
}
