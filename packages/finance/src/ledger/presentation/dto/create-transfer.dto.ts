import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CurrencyField } from '../../../shared/presentation/validation.decorators';
import { TRANSFER_RAILS } from '../../application/commands/ledger.commands';

const transactionStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;

export class TransferFeeDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

/**
 * Account ids are only validated when no (deprecated) card target is sent, so a
 * card target reaches the controller and gets 400 TRANSFER_TARGET_NOT_ACCOUNT
 * instead of a generic validation error.
 */
const hasNoCardTarget = (o: CreateTransferDto) => !o.toCardId && !o.fromCardId;

export class CreateTransferDto {
  @ApiProperty()
  @ValidateIf(hasNoCardTarget)
  @IsUUID()
  fromAccountId!: string;

  @ApiProperty()
  @ValidateIf(hasNoCardTarget)
  @IsUUID()
  toAccountId!: string;

  /**
   * Card targets are not transfers anymore (fase 02 R1). They stay in the DTO
   * only so the controller can answer 400 `TRANSFER_TARGET_NOT_ACCOUNT` instead
   * of a generic validation error.
   */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsUUID()
  toCardId?: string;

  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsUUID()
  fromCardId?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @ApiPropertyOptional({ default: 'DOP', example: 'DOP' })
  @CurrencyField()
  currency?: string;

  @ApiProperty()
  @IsDateString()
  transactionDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ enum: transactionStatuses, default: 'CONFIRMED' })
  @IsOptional()
  @IsEnum(transactionStatuses)
  status?: (typeof transactionStatuses)[number];

  @ApiPropertyOptional({ enum: TRANSFER_RAILS })
  @IsOptional()
  @IsEnum(TRANSFER_RAILS)
  rail?: (typeof TRANSFER_RAILS)[number];

  @ApiPropertyOptional({ type: TransferFeeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TransferFeeDto)
  fee?: TransferFeeDto;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  destinationPending?: boolean;

  @ApiPropertyOptional({
    description: 'Tasa aplicada de la moneda de origen a la de destino',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  exchangeRate?: number;

  @ApiPropertyOptional({
    description: 'Monto que entra en la cuenta de destino, en su moneda',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  receivedAmount?: number;
}

export class UpdateTransferDto extends PartialType(CreateTransferDto) {}
