import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export class OAuthCallbackQueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  state!: string;
}

export class GoogleOAuthUrlQueryDto {
  @ApiProperty()
  @IsUUID()
  institutionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  bankDomain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({
    description:
      'https URL on a CORS_ORIGIN host to send the user after Google consent (web). Omit for the mobile deep link.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  returnTo?: string;
}

@ValidatorConstraint({ name: 'assignEmailMessageTargetXor', async: false })
class AssignEmailMessageTargetXorConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const obj = args.object as AssignEmailMessageDto;
    return Boolean(obj.accountId) !== Boolean(obj.cardId);
  }

  defaultMessage() {
    return 'Provide exactly one of accountId or cardId';
  }
}

export class AssignEmailMessageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @Validate(AssignEmailMessageTargetXorConstraint)
  private readonly _xorTarget?: never;
}
