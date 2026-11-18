import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  IMPORT_REVIEW_ACTIONS,
  type ImportReviewAction,
} from '../../import-review-actions';

export class ResolveImportReviewDto {
  @ApiProperty({
    enum: IMPORT_REVIEW_ACTIONS,
    description:
      'SET_DATE fija la fecha, SET_DESTINATION elige cuenta o tarjeta, LINK_REVERSAL enlaza el original y DISCARD descarta el import.',
  })
  @IsIn(IMPORT_REVIEW_ACTIONS)
  action!: ImportReviewAction;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Fecha de operación para SET_DATE',
  })
  @IsOptional()
  @IsDateString()
  transactionDate?: string;

  @ApiPropertyOptional({
    description: 'Cuenta de destino para SET_DESTINATION',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({
    description: 'Tarjeta de destino para SET_DESTINATION',
  })
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @ApiPropertyOptional({
    description: 'Movimiento original para LINK_REVERSAL',
  })
  @IsOptional()
  @IsUUID()
  originalTransactionId?: string;

  @ApiPropertyOptional({
    description: 'Motivo obligatorio para DISCARD',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
