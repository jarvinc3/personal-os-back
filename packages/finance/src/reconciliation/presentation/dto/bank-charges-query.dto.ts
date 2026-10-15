import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

export const BANK_CHARGES_GROUP_BY = ['month', 'institution', 'kind'] as const;

export type BankChargesGroupBy = (typeof BANK_CHARGES_GROUP_BY)[number];

export class BankChargesQueryDto {
  @ApiPropertyOptional({ description: 'Start date (ISO date)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'End date (ISO date)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: BANK_CHARGES_GROUP_BY })
  @IsOptional()
  @IsIn(BANK_CHARGES_GROUP_BY)
  groupBy?: BankChargesGroupBy;
}
