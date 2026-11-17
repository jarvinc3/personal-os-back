import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const SCOPED_BHD_SYNC_MAX_MESSAGES = 500;
export const SCOPED_BHD_SYNC_DEFAULT_MESSAGES = 100;

/** Ventana y tope de la sync Gmail acotada del piloto BHD (solo DEV). */
export class SyncBhdScopeDto {
  @IsDateString()
  dateFrom!: string;

  @IsDateString()
  dateTo!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SCOPED_BHD_SYNC_MAX_MESSAGES)
  maxMessages: number = SCOPED_BHD_SYNC_DEFAULT_MESSAGES;

  @IsOptional()
  @IsString()
  pageToken?: string;
}
