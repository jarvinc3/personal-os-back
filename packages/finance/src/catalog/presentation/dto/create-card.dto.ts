import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  OptionalCalendarDayField,
  OptionalColorField,
  RequiredLastFourField,
} from '../../../shared/presentation/validation.decorators';

const cardTypes = ['CREDIT', 'DEBIT'] as const;
const cardNetworks = [
  'VISA',
  'MASTERCARD',
  'AMEX',
  'DISCOVER',
  'OTHER',
] as const;

@ValidatorConstraint({ name: 'cardAccountByType', async: false })
class CardAccountByTypeConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as CreateCardDto;
    if (obj.type === 'DEBIT') {
      return typeof obj.accountId === 'string' && obj.accountId.length > 0;
    }
    if (obj.type === 'CREDIT') {
      return obj.accountId === undefined || obj.accountId === null;
    }
    return true;
  }

  defaultMessage() {
    return 'DEBIT cards require accountId; CREDIT cards must not set accountId';
  }
}

export class CreateCardDto {
  @ApiProperty()
  @IsUUID()
  institutionId!: string;

  /** Required for DEBIT (underlying account); must be omitted for CREDIT. */
  @ApiPropertyOptional({
    description: 'Required when type=DEBIT; must be omitted when type=CREDIT',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: cardTypes })
  @IsEnum(cardTypes)
  type!: (typeof cardTypes)[number];

  @Validate(CardAccountByTypeConstraint)
  private readonly _accountByType?: never;

  @ApiPropertyOptional({ enum: cardNetworks })
  @IsOptional()
  @IsEnum(cardNetworks)
  network?: (typeof cardNetworks)[number];

  @ApiProperty({ example: '1234' })
  @RequiredLastFourField()
  lastFour!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @OptionalCalendarDayField()
  statementClosingDay?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @OptionalCalendarDayField()
  paymentDueDay?: number;

  @ApiPropertyOptional()
  @OptionalColorField()
  color?: string;
}
