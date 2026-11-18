import { ApiProperty } from '@nestjs/swagger';

export class ImportReviewItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  signalId!: string;

  @ApiProperty()
  sourceEmailMessageId!: string;

  @ApiProperty({ nullable: true, type: String })
  reviewReason!: string | null;

  @ApiProperty({ type: Object })
  candidate!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ImportReviewResolutionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    enum: ['IMPORTED', 'DUPLICATE', 'REVERSED', 'DISMISSED'],
  })
  status!: string;

  @ApiProperty({
    enum: ['IMPORTED', 'DUPLICATE', 'REVERSED', 'DISMISSED'],
  })
  outcome!: string;

  @ApiProperty({ nullable: true, type: String })
  transactionId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  reviewReason!: string | null;
}
