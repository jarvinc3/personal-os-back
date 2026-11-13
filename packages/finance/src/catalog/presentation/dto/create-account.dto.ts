import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  CurrencyField,
  OptionalAccountNumberField,
  OptionalColorField,
} from '../../../shared/presentation/validation.decorators';

const accountTypes = ['CHECKING', 'SAVINGS', 'CASH', 'INVESTMENT'] as const;

@ValidatorConstraint({ name: 'accountInstitutionByType', async: false })
class AccountInstitutionByTypeConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as CreateAccountDto;
    if (!obj.type) {
      return true;
    }
    if (obj.type === 'CASH') {
      return true;
    }
    return (
      typeof obj.institutionId === 'string' && obj.institutionId.length > 0
    );
  }

  defaultMessage() {
    return 'CHECKING, SAVINGS, and INVESTMENT accounts require institutionId';
  }
}

@ValidatorConstraint({ name: 'accountNumberByType', async: false })
class AccountNumberByTypeConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as CreateAccountDto;
    if (!obj.type) {
      return true;
    }
    if (obj.type === 'CASH') {
      return !obj.accountNumber && !obj.accountNumberLast4;
    }
    const full = obj.accountNumber;
    const last4 = obj.accountNumberLast4;
    if (full && last4) {
      return full.endsWith(last4);
    }
    return Boolean(full || last4);
  }

  defaultMessage(args: ValidationArguments) {
    const obj = args.object as CreateAccountDto;
    if (obj.type === 'CASH') {
      return 'CASH accounts must not set accountNumber or accountNumberLast4';
    }
    return 'CHECKING, SAVINGS, and INVESTMENT accounts require accountNumberLast4 or accountNumber';
  }
}

export class CreateAccountDto {
  @ApiPropertyOptional({
    description:
      'Required for CHECKING, SAVINGS, and INVESTMENT. Optional for CASH.',
  })
  @IsOptional()
  @IsUUID()
  institutionId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: accountTypes })
  @IsEnum(accountTypes)
  type!: (typeof accountTypes)[number];

  @Validate(AccountInstitutionByTypeConstraint)
  private readonly _institutionByType?: never;

  @ApiPropertyOptional({
    description:
      'Optional full account number for CHECKING, SAVINGS, and INVESTMENT; when supplied it is encrypted at rest.',
    example: '001122335678',
  })
  @OptionalAccountNumberField()
  accountNumber?: string;

  @ApiPropertyOptional({
    description:
      'Last four digits for CHECKING, SAVINGS, and INVESTMENT accounts when the full number is unavailable. Must match accountNumber when both are supplied.',
    example: '5678',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'accountNumberLast4 must be 4 digits' })
  accountNumberLast4?: string;

  @Validate(AccountNumberByTypeConstraint)
  private readonly _accountNumberByType?: never;

  @ApiPropertyOptional({ default: 'DOP', example: 'DOP' })
  @CurrencyField()
  currency?: string;

  @ApiPropertyOptional()
  @OptionalColorField()
  color?: string;

  @ApiPropertyOptional({
    description:
      'When true, this account is the fallback ledger target for imported movements from this institution that have no account digits.',
  })
  @IsOptional()
  @IsBoolean()
  isDefaultForInstitution?: boolean;
}
