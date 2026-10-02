import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ConnectEmailSourceDto {
  @ApiProperty({
    description: 'Gmail mailbox already authorized for this user',
  })
  @IsEmail()
  emailAddress!: string;

  @ApiProperty({
    description:
      'Full From address the bank uses for transaction notifications',
  })
  @IsEmail()
  bankSenderEmail!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  bankSenderEmails?: string[];

  @ApiPropertyOptional({
    description: 'Derived from bankSenderEmail when omitted',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  bankDomain?: string;

  @ApiProperty()
  @IsUUID()
  institutionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}
