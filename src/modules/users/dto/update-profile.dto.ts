import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const PREFERENCES_MAX_JSON_CHARS = 8_000;

@ValidatorConstraint({ name: 'preferencesJsonSize', async: false })
class PreferencesJsonSizeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }
    try {
      return JSON.stringify(value).length <= PREFERENCES_MAX_JSON_CHARS;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return `preferences must serialize to at most ${PREFERENCES_MAX_JSON_CHARS} characters`;
  }
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  locale?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  avatarUrl?: string | null;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  @Validate(PreferencesJsonSizeConstraint)
  preferences?: Record<string, unknown>;
}
