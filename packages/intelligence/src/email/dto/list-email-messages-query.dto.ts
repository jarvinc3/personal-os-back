import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Estados que la lista de correos admite como filtro (#414). El enum de la base
 * guarda además `CLASSIFYING` y `DISCARDED`, que no se filtran desde la lista.
 */
export const AI_EMAIL_MESSAGE_STATUS_FILTERS = [
  'INGESTED',
  'QUEUED',
  'PROCESSED',
  'REVIEW_REQUIRED',
  'FAILED',
] as const;

export type AiEmailMessageStatus =
  (typeof AI_EMAIL_MESSAGE_STATUS_FILTERS)[number];

const INVALID_STATUS_MESSAGE = `status debe ser uno de: ${AI_EMAIL_MESSAGE_STATUS_FILTERS.join(', ')}`;

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export class ListEmailMessagesQueryDto {
  @ApiPropertyOptional({
    description:
      'Texto contenido en el asunto o el remitente, sin distinguir mayúsculas',
  })
  @IsOptional()
  @Transform(({ value }) => trimToUndefined(value))
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({
    enum: AI_EMAIL_MESSAGE_STATUS_FILTERS,
    description: 'Estado del correo importado',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? trimToUndefined(value) : value,
  )
  @IsIn(AI_EMAIL_MESSAGE_STATUS_FILTERS, {
    message: INVALID_STATUS_MESSAGE,
  })
  status?: AiEmailMessageStatus;

  @ApiPropertyOptional({ description: 'Cursor opaco de la página anterior' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
