import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

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
}
