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
  CurrencyField,
  OptionalColorField,
} from '../../../shared/presentation/validation.decorators';

const accountTypes = ['CHECKING', 'SAVINGS', 'CASH', 'INVESTMENT'] as const;

@ValidatorConstraint({ name: 'accountInstitutionByType', async: false })
class AccountInstitutionByTypeConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as CreateAccountDto;
    if (obj.type === 'CASH') return true;
    return typeof obj.institutionId === 'string' && obj.institutionId.length > 0;
  }

  defaultMessage() {
    return 'CHECKING, SAVINGS, and INVESTMENT accounts require institutionId';
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

  @ApiPropertyOptional({ default: 'DOP', example: 'DOP' })
  @CurrencyField()
  currency?: string;

  @ApiPropertyOptional()
  @OptionalColorField()
  color?: string;
}
