import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import type { ChatMessage } from '../utils/ai.types';

export class ChatMessageDto implements ChatMessage {
  @ApiProperty({ enum: ['user', 'assistant', 'system'] })
  @IsIn(['user', 'assistant', 'system'])
  role: 'user' | 'assistant' | 'system';

  @ApiProperty({ example: 'Resume mis gastos del mes en una frase.' })
  @IsString()
  @IsNotEmpty()
  content: string;
}
