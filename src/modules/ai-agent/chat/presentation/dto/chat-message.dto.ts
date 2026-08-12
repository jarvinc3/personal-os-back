import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { ChatMessage } from '../../../shared/ai.types';

export class ChatMessageDto implements ChatMessage {
  @ApiProperty({ enum: ['user', 'assistant', 'system'] })
  @IsIn(['user', 'assistant', 'system'])
  role!: 'user' | 'assistant' | 'system';

  @ApiProperty({ example: 'Resume mis gastos del mes en una frase.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  content!: string;
}
