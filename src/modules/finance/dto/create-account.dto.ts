import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

const accountTypes = ['CHECKING', 'SAVINGS', 'CASH', 'INVESTMENT'] as const;

export class CreateAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  institutionId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: accountTypes })
  @IsEnum(accountTypes)
  type!: (typeof accountTypes)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  institution?: string;

  @ApiPropertyOptional({ default: 'DOP' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;
}
