import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import type { AiActionPolicy } from '@personal-os/contracts';

export class SendAiConversationMessageDto {
  @ApiProperty({ example: '¿Cuánto gasté este mes?' })
  @IsString()
  @Length(1, 4000)
  @Matches(/\S/)
  content!: string;
}

export class AiConversationMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant';

  @ApiProperty()
  content!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class AiConversationSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  messageCount!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class AiConversationDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: [AiConversationMessageDto] })
  messages!: AiConversationMessageDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class AiConversationAnswerDto {
  @ApiProperty()
  conversationId!: string;

  @ApiProperty()
  answer!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty()
  model!: string;

  @ApiPropertyOptional({ type: () => [AiConversationActionDto] })
  actions?: AiConversationActionDto[];
}

export class AiConversationActionDto {
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

  @ApiProperty({ type: 'object', additionalProperties: true })
  payload!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  result!: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: Date;
}

export class AiConversationCreatedDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
