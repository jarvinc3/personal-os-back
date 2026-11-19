import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  AI_EMAIL_MESSAGE_STATUS_FILTERS,
  INVALID_EMAIL_MESSAGE_STATUS_MESSAGE,
  type AiEmailMessageStatus,
} from '../ai-email-message-status';

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
    message: INVALID_EMAIL_MESSAGE_STATUS_MESSAGE,
  })
  status?: AiEmailMessageStatus;

  @ApiPropertyOptional({ description: 'Cursor opaco de la página anterior' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
