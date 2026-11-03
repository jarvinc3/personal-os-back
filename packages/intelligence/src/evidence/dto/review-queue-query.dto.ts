import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsBoolean,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  REVIEW_QUEUE_ORDERS,
  REVIEW_QUEUE_PARTITIONS,
  REVIEW_QUEUE_STATUSES,
  type ReviewQueueOrder,
  type ReviewQueuePartition,
  type ReviewQueueStatus,
} from '../review-queue.constants';
import { toReviewQueueStatusList } from '../review-queue.util';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export class ReviewQueueQueryDto {
  @ApiPropertyOptional({
    description: 'Solo mensajes inciertos o sin predicción',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  uncertain?: boolean;

  @ApiPropertyOptional({ description: 'Cursor opaco de la página anterior' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ enum: REVIEW_QUEUE_PARTITIONS })
  @IsOptional()
  @IsIn(REVIEW_QUEUE_PARTITIONS)
  partition?: ReviewQueuePartition;

  @ApiPropertyOptional({
    description:
      'Estados separados por coma; sin filtro la cola devuelve solo PENDING',
    enum: REVIEW_QUEUE_STATUSES,
    isArray: true,
    type: String,
  })
  @IsOptional()
  @Transform(({ value }) => toReviewQueueStatusList(value))
  @IsIn(REVIEW_QUEUE_STATUSES, { each: true })
  status?: ReviewQueueStatus[];

  @ApiPropertyOptional({
    description: 'Remitente exacto, sin distinguir mayúsculas',
    example: 'notifications@github.com',
  })
  @IsOptional()
  @Transform(({ value }) => trimToUndefined(value))
  @IsString()
  @MaxLength(320)
  fromAddress?: string;

  @ApiPropertyOptional({
    description: 'Texto contenido en el asunto, sin distinguir mayúsculas',
  })
  @IsOptional()
  @Transform(({ value }) => trimToUndefined(value))
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({
    description:
      'Primer día recibido (AAAA-MM-DD), completo en la zona del usuario',
    example: '2026-10-01',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dateFrom debe ser AAAA-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'dateFrom no es una fecha válida' })
  dateFrom?: string;

  @ApiPropertyOptional({
    description:
      'Último día recibido (AAAA-MM-DD), completo en la zona del usuario',
    example: '2026-10-31',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dateTo debe ser AAAA-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'dateTo no es una fecha válida' })
  dateTo?: string;

  @ApiPropertyOptional({
    enum: REVIEW_QUEUE_ORDERS,
    default: 'OLDEST',
    description: 'Fecha recibida, del más viejo al más nuevo o al revés',
  })
  @IsOptional()
  @IsIn(REVIEW_QUEUE_ORDERS)
  order?: ReviewQueueOrder;
}
