import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AiSignalEvidenceResponseDto {
  @ApiProperty({ example: 'EMAIL_CLASSIFICATION' })
  sourceType!: string;

  @ApiProperty()
  sourceId!: string;

  @ApiProperty({ type: Object })
  excerpt!: Record<string, unknown>;

  @ApiProperty()
  createdAt!: Date;
}

export class AiSignalResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  domain!: string;

  @ApiProperty({
    enum: [
      'DETECTED',
      'VALIDATED',
      'ROUTED',
      'CONSUMED',
      'DISMISSED',
      'SUPERSEDED',
      'FAILED',
    ],
  })
  status!: string;

  @ApiProperty()
  sourceType!: string;

  @ApiProperty()
  sourceId!: string;

  @ApiProperty({ type: Object })
  payload!: Record<string, unknown>;

  @ApiProperty()
  correlationKey!: string;

  @ApiProperty()
  occurredAt!: Date;

  @ApiProperty()
  detectedAt!: Date;

  @ApiPropertyOptional({ type: Number })
  confidence?: number | null;

  @ApiProperty({ type: [AiSignalEvidenceResponseDto] })
  evidence!: AiSignalEvidenceResponseDto[];
}

export class AiSignalListResponseDto {
  @ApiProperty({ type: [AiSignalResponseDto] })
  data!: AiSignalResponseDto[];
}
