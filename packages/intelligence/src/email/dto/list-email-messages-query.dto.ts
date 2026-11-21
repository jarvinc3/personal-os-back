import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AI_EMAIL_MESSAGE_STATUS_FILTERS,
  INVALID_EMAIL_MESSAGE_STATUS_MESSAGE,
  type AiEmailMessageStatus,
} from '../ai-email-message-status';
import {
  EMAIL_MESSAGES_DEFAULT_PAGE_SIZE,
  EMAIL_MESSAGES_MAX_PAGE_SIZE,
  INVALID_EMAIL_MESSAGES_LIMIT_MESSAGE,
} from '../email-messages-pagination.constants';

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

  @ApiPropertyOptional({
    description: 'Cantidad de correos por página',
    minimum: 1,
    maximum: EMAIL_MESSAGES_MAX_PAGE_SIZE,
    default: EMAIL_MESSAGES_DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: INVALID_EMAIL_MESSAGES_LIMIT_MESSAGE })
  @Min(1, { message: INVALID_EMAIL_MESSAGES_LIMIT_MESSAGE })
  @Max(EMAIL_MESSAGES_MAX_PAGE_SIZE, {
    message: INVALID_EMAIL_MESSAGES_LIMIT_MESSAGE,
  })
  limit: number = EMAIL_MESSAGES_DEFAULT_PAGE_SIZE;
}
