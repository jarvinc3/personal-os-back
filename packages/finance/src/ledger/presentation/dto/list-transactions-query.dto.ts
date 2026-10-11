import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { CursorQueryDto } from '@personal-os/core';
import {
  FIN_TRANSACTION_STATUSES,
  FIN_TRANSACTION_TYPES,
  type FinTransactionStatusValue,
  type FinTransactionTypeValue,
} from '../../../shared/domain/transaction-status';

export class ListTransactionsQueryDto extends CursorQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  transferGroupId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: FIN_TRANSACTION_TYPES })
  @IsOptional()
  @IsEnum(FIN_TRANSACTION_TYPES)
  type?: FinTransactionTypeValue;

  @ApiPropertyOptional({ enum: FIN_TRANSACTION_STATUSES })
  @IsOptional()
  @IsEnum(FIN_TRANSACTION_STATUSES)
  status?: FinTransactionStatusValue;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => String)
  @IsString()
  search?: string;
}
