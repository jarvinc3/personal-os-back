import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ConnectEmailSourceDto {
  @ApiProperty()
  @IsEmail()
  emailAddress!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(150)
  bankDomain!: string;

  @ApiProperty()
  @IsUUID()
  institutionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}
