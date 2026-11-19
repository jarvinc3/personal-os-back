import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
  IsUUID,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AiActionPolicy } from '@personal-os/contracts';
import { AI_INVOCATION_ENTITY_TYPES } from '@personal-os/core';

export class AiInvocationEntityRefDto {
  @ApiProperty({ enum: AI_INVOCATION_ENTITY_TYPES })
  @IsIn(AI_INVOCATION_ENTITY_TYPES)
  @IsString()
  @Length(1, 80)
  type!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class AiInvocationContextDto {
  @ApiProperty({ example: '/finance/products/transactions' })
  @IsString()
  @Length(1, 300)
  route!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  view?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  sheet?: string;

  @ApiPropertyOptional({ type: () => AiInvocationEntityRefDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiInvocationEntityRefDto)
  entityRef?: AiInvocationEntityRefDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}

export class SendAiConversationMessageDto {
  @ApiProperty({ example: '¿Cuánto gasté este mes?' })
  @IsString()
  @Length(1, 4000)
  @Matches(/\S/)
  content!: string;

  @ApiPropertyOptional({ type: () => AiInvocationContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiInvocationContextDto)
  context?: AiInvocationContextDto;
}

export class CreateAiConversationDto {
  @ApiPropertyOptional({ type: () => AiInvocationContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiInvocationContextDto)
  context?: AiInvocationContextDto;
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

  @ApiPropertyOptional({ type: () => AiInvocationContextDto, nullable: true })
  context!: AiInvocationContextDto | null;

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
