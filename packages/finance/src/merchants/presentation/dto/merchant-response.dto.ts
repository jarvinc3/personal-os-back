import { ApiProperty } from '@nestjs/swagger';
import { MERCHANT_CATEGORY_SOURCE } from '../../domain/merchant-category-source';
import { MERCHANT_DUPLICATE_REASON } from '../../domain/merchant-duplicates';

export class MerchantResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  normalizedKey!: string;

  @ApiProperty({ type: [String] })
  aliases!: string[];

  @ApiProperty({ nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({
    enum: Object.values(MERCHANT_CATEGORY_SOURCE),
    nullable: true,
  })
  categorySource!: string | null;

  @ApiProperty({ nullable: true, type: String })
  domain!: string | null;

  @ApiProperty({ nullable: true, type: String })
  logoUrl!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '1500.00' })
  monthSpend!: string;

  @ApiProperty()
  monthMovements!: number;
}

export class MerchantListItemResponseDto extends MerchantResponseDto {
  @ApiProperty()
  possibleDuplicates!: number;
}

export class MerchantPageResponseDto {
  @ApiProperty({ type: () => [MerchantListItemResponseDto] })
  items!: MerchantListItemResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class MerchantSuggestResponseDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({
    enum: Object.values(MERCHANT_CATEGORY_SOURCE),
    nullable: true,
  })
  categorySource!: string | null;
}

export class MerchantDuplicateResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  logoUrl!: string | null;

  @ApiProperty({ example: '1500.00' })
  monthSpend!: string;

  @ApiProperty()
  monthMovements!: number;

  @ApiProperty({ enum: Object.values(MERCHANT_DUPLICATE_REASON) })
  reason!: string;
}

export class MerchantDuplicateDismissResponseDto {
  @ApiProperty()
  dismissed!: boolean;
}
