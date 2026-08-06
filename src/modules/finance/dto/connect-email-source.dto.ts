import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsEmail,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Validate,
    ValidationArguments,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'emailSourceTargetXor', async: false })
class EmailSourceTargetXorConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as ConnectEmailSourceDto;
    const hasAccount = Boolean(obj.accountId);
    const hasCard = Boolean(obj.cardId);
    return !(hasAccount && hasCard);
  }

  defaultMessage() {
    return 'Provide at most one of accountId or cardId';
  }
}

export class ConnectEmailSourceDto {
  @ApiProperty()
  @IsEmail()
  emailAddress!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(150)
  bankDomain!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @Validate(EmailSourceTargetXorConstraint)
  private readonly _targetXor?: never;
}
