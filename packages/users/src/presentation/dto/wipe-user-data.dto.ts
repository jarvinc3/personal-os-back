import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { WIPE_LAYER_IDS, type WipeLayerId } from '../../domain/wipe-layers';

export class WipeUserDataDto {
  @ApiProperty({
    enum: WIPE_LAYER_IDS,
    isArray: true,
    description: 'Data layers to wipe; at least one, no duplicates',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(WIPE_LAYER_IDS, { each: true })
  layers!: WipeLayerId[];

  @ApiPropertyOptional({
    description:
      'Institution whose accounts to zero and whose credit cards to restore to their limit. Omit to cover every institution, including cash. Applied only when finance.balances is selected.',
  })
  @IsOptional()
  @IsUUID()
  balanceInstitutionId?: string;
}
