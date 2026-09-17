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

const transactionTypes = ['DEBIT', 'CREDIT'] as const;
const transactionStatuses = [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'DECLINED',
  'REVERSED',
] as const;

@ValidatorConstraint({ name: 'xorAccountCard', async: false })
class XorAccountCardConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as { accountId?: string; cardId?: string };
    const hasAccount = Boolean(obj.accountId);
    const hasCard = Boolean(obj.cardId);
    return hasAccount !== hasCard;
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

  @ApiProperty({ enum: transactionTypes })
  @IsEnum(transactionTypes)
  type!: (typeof transactionTypes)[number];

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

  @ApiPropertyOptional({ enum: transactionStatuses, default: 'CONFIRMED' })
  @IsOptional()
  @IsEnum(transactionStatuses)
  status?: (typeof transactionStatuses)[number];
}
