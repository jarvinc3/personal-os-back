import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ApplyStatementImportDto {
  @ApiPropertyOptional({
    description: 'Create an adjustment for the remaining balance difference',
  })
  @IsOptional()
  @IsBoolean()
  adjust?: boolean;
}
