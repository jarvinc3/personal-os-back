import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

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
