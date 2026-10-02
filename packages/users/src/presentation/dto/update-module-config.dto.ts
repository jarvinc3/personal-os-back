import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const MODULE_CONFIG_MAX_JSON_CHARS = 8_000;

@ValidatorConstraint({ name: 'moduleConfigJsonSize', async: false })
class ModuleConfigJsonSizeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }
    try {
      return JSON.stringify(value).length <= MODULE_CONFIG_MAX_JSON_CHARS;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return `config must serialize to at most ${MODULE_CONFIG_MAX_JSON_CHARS} characters`;
  }
}

export class UpdateModuleConfigDto {
  @ApiPropertyOptional({
    type: Object,
    description: 'Partial module config (merged with defaults)',
  })
  @IsOptional()
  @IsObject()
  @Validate(ModuleConfigJsonSizeConstraint)
  config?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Enable or disable the module for this user',
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
