import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StatementImportUploadDto {
  @ApiPropertyOptional({
    description: 'PDF password; never stored or logged',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;
}
