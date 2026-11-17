import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DRY_RUN_SELECTION_LIMIT } from '../email-sample-import.service';

/**
 * Una sola forma de selección: ids explícitos o remitente con ventana. Nunca
 * las dos. El máximo del DTO es 50; el servicio baja a 20 al ejecutar sin
 * `dryRun`.
 */
export class EmailSampleImportSelectionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DRY_RUN_SELECTION_LIMIT)
  @IsString({ each: true })
  messageIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sender?: string;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}

export class EmailSampleImportDto {
  @IsBoolean()
  dryRun!: boolean;

  @IsDefined()
  @ValidateNested()
  @Type(() => EmailSampleImportSelectionDto)
  selection!: EmailSampleImportSelectionDto;
}
