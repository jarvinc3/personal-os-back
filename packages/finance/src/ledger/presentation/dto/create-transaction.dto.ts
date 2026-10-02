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
import { CurrencyField } from '../../../shared/presentation/validation.decorators';
import { isXorTargetValid } from '../../../shared/domain/ledger-rules';
import {
  FIN_TRANSACTION_STATUSES,
  MANUAL_TRANSACTION_TYPES,
} from '../../../shared/domain/transaction-status';

@ValidatorConstraint({ name: 'xorAccountCard', async: false })
class XorAccountCardConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as { accountId?: string; cardId?: string };
    return isXorTargetValid(obj.accountId, obj.cardId);
  }

  defaultMessage() {
    return 'Provide exactly one of accountId or cardId';
  }
}

export class CreateTransactionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @Validate(XorAccountCardConstraint)
  private readonly _xorTarget?: never;

  @ApiProperty({ enum: MANUAL_TRANSACTION_TYPES })
  @IsEnum(MANUAL_TRANSACTION_TYPES)
  type!: (typeof MANUAL_TRANSACTION_TYPES)[number];

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
  merchant?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  categoryId?: string;

  @ApiPropertyOptional({
    enum: FIN_TRANSACTION_STATUSES,
    default: 'CONFIRMED',
  })
  @IsOptional()
  @IsEnum(FIN_TRANSACTION_STATUSES)
  status?: (typeof FIN_TRANSACTION_STATUSES)[number];
}
