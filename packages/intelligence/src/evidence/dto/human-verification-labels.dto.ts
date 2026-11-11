import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO4217CurrencyCode,
  IsISO8601,
  IsNotEmpty,
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
  SUGGESTED_TRANSACTION_DATE_SOURCES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_KINDS,
  TRANSACTION_MOVEMENT_CLASSES,
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

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  suggestedTransactionDate?: string;

  @ApiPropertyOptional({ enum: SUGGESTED_TRANSACTION_DATE_SOURCES })
  @IsOptional()
  @IsIn(SUGGESTED_TRANSACTION_DATE_SOURCES)
  suggestedTransactionDateSource?: (typeof SUGGESTED_TRANSACTION_DATE_SOURCES)[number];

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

  @ApiPropertyOptional({
    pattern: '^\\d{4}$',
    description:
      'Terminación de la cuenta propia de origen; en una transferencia es la única pista de cuenta.',
  })
  @IsOptional()
  @Matches(/^\d{4}$/)
  accountNumberLast4?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_MOVEMENT_CLASSES })
  @IsOptional()
  @IsIn(TRANSACTION_MOVEMENT_CLASSES)
  movementClass?: (typeof TRANSACTION_MOVEMENT_CLASSES)[number];

  @ApiPropertyOptional({
    description: 'Referencia del movimiento original de un reverso.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  reverseOfBankReference?: string;

  @ApiPropertyOptional({
    description: 'Id del correo original de un reverso.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  reverseOfEmailMessageId?: string;
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
