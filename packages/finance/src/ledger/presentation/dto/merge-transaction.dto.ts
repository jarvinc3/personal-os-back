import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class MergeTransactionDto {
  @ApiProperty({ description: 'Movement to keep' })
  @IsUUID()
  intoId!: string;
}
