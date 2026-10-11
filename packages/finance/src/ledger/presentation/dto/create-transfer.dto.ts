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

const transactionStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;

@ValidatorConstraint({ name: 'transferDestinationXor', async: false })
class TransferDestinationXorConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as CreateTransferDto;
    return (
      Boolean(obj.toAccountId) !== Boolean(obj.toCardId) &&
      (Boolean(obj.toAccountId) || Boolean(obj.toCardId))
    );
  }

  defaultMessage() {
    return 'A transfer arrives at exactly one accountId or cardId (to*)';
  }
}

export class CreateTransferDto {
  @ApiProperty()
  @IsUUID()
  fromAccountId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  toCardId?: string;

  @Validate(TransferDestinationXorConstraint)
  private readonly _destinationXor?: never;

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
