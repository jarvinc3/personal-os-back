import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ChatContextDto } from './chat-context.dto';

export class CreateAiSessionDto {
  @ApiPropertyOptional({ default: 'general' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  contextType?: string;

  @ApiPropertyOptional({
    description: 'Module slug to scope the session (agenda, projects, etc.)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  moduleSlug?: string;

  @ApiPropertyOptional({ type: ChatContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatContextDto)
  context?: ChatContextDto;
}
