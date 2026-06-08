import { ApiProperty } from '@nestjs/swagger';

export class AiProviderInfoDto {
  @ApiProperty({ example: 'Groq' })
  name!: string;

  @ApiProperty({ example: 'llama-3.3-70b-versatile' })
  model!: string;
}
