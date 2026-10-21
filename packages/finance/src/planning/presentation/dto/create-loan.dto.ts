import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsUUID,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { LoanFieldsDto } from './loan-fields.dto';

@ValidatorConstraint({ name: 'loanBalanceWithinOriginal', async: false })
class LoanBalanceWithinOriginalConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const loanFields = args.object as LoanFieldsDto;
    return (
      typeof loanFields.originalAmount !== 'number' ||
      typeof loanFields.currentBalance !== 'number' ||
      loanFields.currentBalance <= loanFields.originalAmount
    );
  }

  defaultMessage() {
    return 'currentBalance must not exceed originalAmount';
  }
}

@ValidatorConstraint({ name: 'loanPaidWithinTotal', async: false })
class LoanPaidWithinTotalConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const loanFields = args.object as LoanFieldsDto;
    return (
      typeof loanFields.totalInstallments !== 'number' ||
      typeof loanFields.paidInstallments !== 'number' ||
      loanFields.paidInstallments <= loanFields.totalInstallments
    );
  }

  defaultMessage() {
    return 'paidInstallments must not exceed totalInstallments';
  }
}

export class CreateLoanDto extends LoanFieldsDto {
  @ApiPropertyOptional({
    description:
      'Cuenta que recibe el capital desembolsado. Se acredita al crear el préstamo.',
  })
  @IsOptional()
  @IsUUID()
  disbursementAccountId?: string;

  @Validate(LoanBalanceWithinOriginalConstraint)
  @Validate(LoanPaidWithinTotalConstraint)
  private readonly _loanConsistency?: never;
}
