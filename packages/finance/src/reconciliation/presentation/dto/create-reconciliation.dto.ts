import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  RECONCILIATION_ADJUSTMENT_KINDS,
  type ReconciliationAdjustmentKind,
} from '../../domain/reconciliation-adjustment';
import { PreviewReconciliationDto } from './preview-reconciliation.dto';

export class ReconciliationAdjustmentDto {
  @ApiProperty({ enum: RECONCILIATION_ADJUSTMENT_KINDS })
  @IsIn(RECONCILIATION_ADJUSTMENT_KINDS)
  kind!: ReconciliationAdjustmentKind;

  @ApiProperty({ description: 'Signed amount; charges are negative' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;
}

export class CreateReconciliationDto extends PreviewReconciliationDto {
  @ApiPropertyOptional({ type: [ReconciliationAdjustmentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReconciliationAdjustmentDto)
  adjustments?: ReconciliationAdjustmentDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
