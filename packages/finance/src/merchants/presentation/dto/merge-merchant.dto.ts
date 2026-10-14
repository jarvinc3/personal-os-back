import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class MergeMerchantDto {
  @ApiProperty({ description: 'Merchant that keeps the movements' })
  @IsUUID()
  targetId!: string;
}
