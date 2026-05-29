import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const cardTypes = ['CREDIT', 'DEBIT'] as const;
const cardNetworks = ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER', 'OTHER'] as const;

export class CreateCardDto {
  @ApiProperty()
  @IsString()
  institutionId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: cardTypes })
  @IsEnum(cardTypes)
  type!: (typeof cardTypes)[number];

  @ApiPropertyOptional({ enum: cardNetworks })
  @IsOptional()
  @IsEnum(cardNetworks)
  network?: (typeof cardNetworks)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(4, 4)
  lastFour?: string;

  @ApiPropertyOptional()
  @IsOptional()
  statementClosingDay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  paymentDueDay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;
}
