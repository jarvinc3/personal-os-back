import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateHumanVerificationDto {
  @IsIn(['CONFIRMED', 'CORRECTED', 'REJECTED'])
  verdict!: 'CONFIRMED' | 'CORRECTED' | 'REJECTED';

  @IsOptional()
  @IsBoolean()
  relevance?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  semanticType?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  routes?: string[];

  @IsOptional()
  @IsObject()
  transaction?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  notes?: string;
}
