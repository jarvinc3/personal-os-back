import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsDateString,
    IsEnum,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Validate,
    ValidationArguments,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { CurrencyField } from '../lib/finance-validation';

const transactionStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;

@ValidatorConstraint({ name: 'transferLegXor', async: false })
class TransferLegXorConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as CreateTransferDto;
    const fromOk =
      Boolean(obj.fromAccountId) !== Boolean(obj.fromCardId) &&
      (Boolean(obj.fromAccountId) || Boolean(obj.fromCardId));
    const toOk =
      Boolean(obj.toAccountId) !== Boolean(obj.toCardId) &&
      (Boolean(obj.toAccountId) || Boolean(obj.toCardId));
    return fromOk && toOk;
  }

  defaultMessage() {
    return 'Each transfer leg must provide exactly one of accountId or cardId (from*/to*)';
  }
}

export class CreateTransferDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fromAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fromCardId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  toCardId?: string;

  @Validate(TransferLegXorConstraint)
  private readonly _legXor?: never;

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
}
