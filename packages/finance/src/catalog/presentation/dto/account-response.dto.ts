import { ApiProperty } from '@nestjs/swagger';

const ACCOUNT_TYPES = ['CHECKING', 'SAVINGS', 'CASH', 'INVESTMENT'] as const;

export class AccountResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  institutionId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  institutionName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  institutionLogoUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  institutionColor!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ACCOUNT_TYPES })
  type!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ nullable: true, type: String })
  accountNumberLast4!: string | null;

  @ApiProperty()
  isDefaultForInstitution!: boolean;

  /** Decimal as text: the API never sends money as a JSON number. */
  @ApiProperty({ example: '1500.00' })
  balance!: string;

  @ApiProperty({ example: '0.00' })
  earmarkedAmount!: string;

  @ApiProperty({ example: '1500.00' })
  freeBalance!: string;

  @ApiProperty({ nullable: true, type: String })
  color!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AccountPageResponseDto {
  @ApiProperty({ type: () => [AccountResponseDto] })
  items!: AccountResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class InstrumentHistoryItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'ADJUSTMENT' })
  kind!: string;

  @ApiProperty({ format: 'date-time' })
  at!: string;

  @ApiProperty({ nullable: true, type: String, example: '1500.00' })
  amount!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'DOP' })
  currency!: string | null;

  @ApiProperty({ type: Object })
  payload!: Record<string, unknown>;
}

export class InstrumentHistoryPageResponseDto {
  @ApiProperty({ type: () => [InstrumentHistoryItemDto] })
  items!: InstrumentHistoryItemDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
