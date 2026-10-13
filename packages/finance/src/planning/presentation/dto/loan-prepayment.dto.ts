import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { LOAN_PREPAYMENT_MODE } from '../../domain/loan-payment';

const prepaymentModes = [
  LOAN_PREPAYMENT_MODE.REDUCE_TERM,
  LOAN_PREPAYMENT_MODE.REDUCE_INSTALLMENT,
] as const;

export class LoanPrepaymentDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @ApiProperty()
  @IsUUID()
  accountId!: string;

  @ApiProperty({ enum: prepaymentModes })
  @IsEnum(prepaymentModes)
  mode!: (typeof prepaymentModes)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  penaltyAmount?: number;
}

export class LoanPrepaymentPreviewDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @ApiProperty({ enum: prepaymentModes })
  @IsEnum(prepaymentModes)
  mode!: (typeof prepaymentModes)[number];
}
