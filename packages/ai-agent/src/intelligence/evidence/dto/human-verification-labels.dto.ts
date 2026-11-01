import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO4217CurrencyCode,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  SEMANTIC_ROUTES,
  SEMANTIC_TYPES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_KINDS,
} from '../human-verification.constants';

export class HumanVerificationTransactionDto {
  @ApiPropertyOptional({ enum: TRANSACTION_KINDS })
  @IsOptional()
  @IsIn(TRANSACTION_KINDS)
  kind?: (typeof TRANSACTION_KINDS)[number];

  @ApiPropertyOptional({ type: Number, minimum: 0, exclusiveMinimum: true })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ example: 'DOP' })
  @IsOptional()
  @IsISO4217CurrencyCode()
  currency?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  transactionDate?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_DIRECTIONS })
  @IsOptional()
  @IsIn(TRANSACTION_DIRECTIONS)
  direction?: (typeof TRANSACTION_DIRECTIONS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  merchant?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bankReference?: string;

  @ApiPropertyOptional({ pattern: '^\\d{4}$' })
  @IsOptional()
  @Matches(/^\d{4}$/)
  last4?: string;
}

export class HumanVerificationLabelsDto {
  @IsOptional()
  @IsBoolean()
  relevance?: boolean;

  @ApiPropertyOptional({ enum: SEMANTIC_TYPES })
  @IsOptional()
  @IsIn(SEMANTIC_TYPES)
  semanticType?: (typeof SEMANTIC_TYPES)[number];

  @ApiPropertyOptional({ type: String, enum: SEMANTIC_ROUTES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(SEMANTIC_ROUTES, { each: true })
  routes?: (typeof SEMANTIC_ROUTES)[number][];

  @ApiPropertyOptional({ type: HumanVerificationTransactionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HumanVerificationTransactionDto)
  transaction?: HumanVerificationTransactionDto;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  notes?: string;
}
