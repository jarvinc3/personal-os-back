import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @ApiPropertyOptional({
    description:
      'https URL on a CORS_ORIGIN host to send the user after Google consent (web). Omit for the mobile deep link.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  returnTo?: string;
}
