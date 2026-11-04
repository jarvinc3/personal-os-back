import { ApiProperty } from '@nestjs/swagger';
import type { AiActionPolicy } from '@personal-os/contracts';

export class AiActionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  actionType!: string;

  @ApiProperty()
  targetModule!: string;

  @ApiProperty({ enum: ['AUTO_ALLOWED', 'CONFIRM_REQUIRED', 'FORBIDDEN'] })
  policy!: AiActionPolicy;

  @ApiProperty({
    enum: ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'],
  })
  status!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  payload!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  result!: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true })
  executedAt!: Date | null;
}

export class AiActionResultDto {
  @ApiProperty({
    enum: [
      'PENDING_CONFIRMATION',
      'EXECUTED',
      'ALREADY_EXECUTED',
      'ALREADY_CLAIMED',
      'FORBIDDEN',
      'FAILED',
      'CANCELLED',
    ],
  })
  outcome!: string;

  @ApiProperty({ type: AiActionDto })
  action!: AiActionDto;
}
