import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';

/** Upper bound of receivables per link, so one URL stays manageable. */
export const MAX_RECEIVABLE_SHARE_ITEMS = 50;

export class CreateReceivableShareDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: MAX_RECEIVABLE_SHARE_ITEMS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECEIVABLE_SHARE_ITEMS)
  @ArrayUnique()
  @IsString({ each: true })
  receivableIds!: string[];

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  debtorName!: string;
}
