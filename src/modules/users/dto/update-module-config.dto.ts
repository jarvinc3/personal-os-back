import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class UpdateModuleConfigDto {
  @ApiPropertyOptional({
    type: Object,
    description: 'Partial module config (merged with defaults)',
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Enable or disable the module for this user' })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
