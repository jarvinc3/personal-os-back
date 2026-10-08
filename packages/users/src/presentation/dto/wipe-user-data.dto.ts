import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsIn } from 'class-validator';
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
}
