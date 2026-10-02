import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ChatMessageDto } from './chat-message.dto';

export class ChatRequestDto {
  @ApiPropertyOptional({
    description: 'Optional AI session id to attach metrics',
  })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({
    description: 'Client-generated id for idempotent message delivery',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientMessageId?: string;

  @ApiProperty({ type: [ChatMessageDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}
