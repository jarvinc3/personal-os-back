import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const installmentFreqs = ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;

export class CreateLoanDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  lenderName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  originalAmount!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  currentBalance!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  installmentAmount!: number;

  @ApiProperty({ enum: installmentFreqs })
  @IsEnum(installmentFreqs)
  installmentFreq!: (typeof installmentFreqs)[number];

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  totalInstallments!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  paidInstallments?: number;

  @ApiProperty()
  @IsDateString()
  nextDueDate!: string;
}
