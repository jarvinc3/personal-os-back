import { ApiProperty } from '@nestjs/swagger';

const QUICK_ENTRY_TYPES = ['DEBIT', 'CREDIT'] as const;

export class QuickEntryDraftResponseDto {
  @ApiProperty({ enum: QUICK_ENTRY_TYPES })
  type!: string;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardId!: string | null;

  @ApiProperty({ format: 'date' })
  date!: string;

  @ApiProperty({ nullable: true, type: String })
  merchant!: string | null;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;
}

export class QuickEntryParseResponseDto {
  @ApiProperty({ type: () => QuickEntryDraftResponseDto })
  draft!: QuickEntryDraftResponseDto;

  @ApiProperty({ example: 0.9 })
  confidence!: number;

  @ApiProperty({ type: [String] })
  missing!: string[];
}
