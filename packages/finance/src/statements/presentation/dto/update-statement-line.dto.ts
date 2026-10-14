import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const STATEMENT_LINE_DECISIONS = ['MATCH', 'CREATE', 'IGNORE'] as const;

export type StatementLineDecisionDto =
  (typeof STATEMENT_LINE_DECISIONS)[number];

export class UpdateStatementLineDto {
  @ApiPropertyOptional({ enum: STATEMENT_LINE_DECISIONS })
  @IsIn(STATEMENT_LINE_DECISIONS)
  decision!: StatementLineDecisionDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transactionId?: string | null;
}
