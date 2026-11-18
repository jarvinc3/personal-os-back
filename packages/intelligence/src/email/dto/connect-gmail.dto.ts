import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  GMAIL_IMPORT_PERIODS,
  GMAIL_SENDER_FILTER_PATTERN,
  type GmailImportPeriod,
} from '../gmail-import-scope';

export class ConnectGmailDto {
  @ApiPropertyOptional({
    enum: GMAIL_IMPORT_PERIODS,
    description:
      'Desde cuándo importar: hoy, el último mes o los últimos 3 meses.',
  })
  @IsOptional()
  @IsIn([...GMAIL_IMPORT_PERIODS])
  period?: GmailImportPeriod;

  @ApiPropertyOptional({
    example: 'bhd.com.do',
    description: 'Limita la importación a un dominio de remitente.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(GMAIL_SENDER_FILTER_PATTERN)
  senderFilter?: string | null;
}
