import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AiActionSummary, ChatBlock, SideEffectDescriptor } from '../../../shared/ai.types';

export class ChatResponseDto {
  @ApiProperty()
  sessionId!: string;

  @ApiProperty({ example: 'Groq' })
  provider!: string;

  @ApiProperty({ example: 'llama-3.3-70b-versatile' })
  model!: string;

  @ApiProperty({ example: 'finance', description: 'Module context used for this reply' })
  moduleSlug!: string;

  @ApiProperty({ example: 'Finanzas' })
  moduleLabel!: string;

  @ApiProperty({
    example: 'Aquí tienes un resumen de tus gastos del mes...',
  })
  content!: string;

  @ApiPropertyOptional()
  requiresConfirmation?: boolean;

  @ApiPropertyOptional()
  actions?: AiActionSummary[];

  @ApiPropertyOptional()
  sideEffects?: SideEffectDescriptor[];

  @ApiPropertyOptional()
  blocks?: ChatBlock[];
}
