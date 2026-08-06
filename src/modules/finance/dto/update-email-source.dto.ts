import { ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Validate,
    ValidationArguments,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'updateEmailSourceTargetXor', async: false })
class UpdateEmailSourceTargetXorConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as UpdateEmailSourceDto;
    return !(obj.accountId && obj.cardId);
  }

  defaultMessage() {
    return 'Provide at most one of accountId or cardId';
  }
}

export class UpdateEmailSourceDto {
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
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  bankDomain?: string;

  @Validate(UpdateEmailSourceTargetXorConstraint)
  private readonly _targetXor?: never;
}
