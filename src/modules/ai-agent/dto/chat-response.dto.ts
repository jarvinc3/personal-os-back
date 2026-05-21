import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatResponseDto {
  @ApiProperty()
  sessionId!: string;

  @ApiProperty({ example: 'Groq' })
  provider!: string;

  @ApiProperty({ example: 'llama-3.3-70b-versatile' })
  model!: string;

  @ApiProperty({
    example: 'Aquí tienes un resumen de tus gastos del mes...',
  })
  content!: string;

  @ApiPropertyOptional()
  requiresConfirmation?: boolean;
}
