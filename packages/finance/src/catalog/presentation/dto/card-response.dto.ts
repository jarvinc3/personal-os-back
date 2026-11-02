import { ApiProperty } from '@nestjs/swagger';

const CARD_TYPES = ['CREDIT', 'DEBIT'] as const;
const CARD_NETWORKS = [
  'VISA',
  'MASTERCARD',
  'AMEX',
  'DISCOVER',
  'OTHER',
] as const;

export class CardBalanceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  /** Decimal as text: the API never sends money as a JSON number. */
  @ApiProperty({ example: '1500.00' })
  balance!: string;

  @ApiProperty({ nullable: true, type: String, example: '50000.00' })
  creditLimit!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '48500.00' })
  availableCredit!: string | null;
}

export class CardResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  institutionId!: string;

  @ApiProperty()
  institutionName!: string;

  @ApiProperty({ nullable: true, type: String })
  institutionLogoUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  institutionColor!: string | null;

  @ApiProperty({ nullable: true, type: String })
  networkLogoUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Linked account name; only debit cards have one.',
  })
  accountName!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: CARD_TYPES })
  type!: string;

  @ApiProperty({ nullable: true, enum: CARD_NETWORKS })
  network!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '4242' })
  lastFour!: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 15 })
  statementClosingDay!: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 5 })
  paymentDueDay!: number | null;

  @ApiProperty({ nullable: true, type: String, format: 'date' })
  nextStatementDate!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date' })
  nextPaymentDueDate!: string | null;

  @ApiProperty({ nullable: true, type: String })
  color!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: () => [CardBalanceResponseDto] })
  balances!: CardBalanceResponseDto[];
}

export class CardPageResponseDto {
  @ApiProperty({ type: () => [CardResponseDto] })
  items!: CardResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class CardBalanceMutationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  cardId!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ example: '1500.00' })
  balance!: string;

  @ApiProperty({ nullable: true, type: String, example: '50000.00' })
  creditLimit!: string | null;
}
