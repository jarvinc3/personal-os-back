import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export class ReconciliationStatusQueryDto {
  @ApiProperty({ example: '2026-10', description: 'Month as YYYY-MM' })
  @Matches(MONTH_REGEX, { message: 'month must be YYYY-MM' })
  month!: string;
}
