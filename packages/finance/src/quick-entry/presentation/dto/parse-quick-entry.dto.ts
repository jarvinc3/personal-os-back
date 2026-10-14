import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ParseQuickEntryDto {
  @ApiProperty({
    example: 'café 250 popular',
    description: 'Short natural-language sentence to turn into a draft.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(280)
  text!: string;
}
