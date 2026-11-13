import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class DiscoverEmailProductProposalsDto {
  @ApiPropertyOptional({ type: [String], maxItems: 200 })
  @IsOptional()
  @IsUUID('4', { each: true })
  messageIds?: string[];

  @ApiPropertyOptional({ default: 200, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ListEmailProductProposalsDto {
  @ApiPropertyOptional({
    enum: ['PENDING', 'APPROVING', 'APPROVED', 'DISCARDED'],
  })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVING', 'APPROVED', 'DISCARDED'])
  status?: 'PENDING' | 'APPROVING' | 'APPROVED' | 'DISCARDED';
}

export class UpdateEmailProductProposalDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: ['CHECKING', 'SAVINGS', 'INVESTMENT'] })
  @IsOptional()
  @IsIn(['CHECKING', 'SAVINGS', 'INVESTMENT'])
  accountType?: 'CHECKING' | 'SAVINGS' | 'INVESTMENT';

  @ApiPropertyOptional({ enum: ['CREDIT', 'DEBIT'] })
  @IsOptional()
  @IsIn(['CREDIT', 'DEBIT'])
  cardType?: 'CREDIT' | 'DEBIT';

  @ApiPropertyOptional({ example: 'DOP' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ example: '5678' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/)
  lastFour?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 48 })
  @IsOptional()
  @IsString()
  @MaxLength(48)
  @Matches(/^[0-9\s-]{4,48}$/)
  accountNumber?: string | null;

  @ApiPropertyOptional({
    enum: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER', 'OTHER'],
  })
  @IsOptional()
  @IsIn(['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER', 'OTHER'])
  network?: 'VISA' | 'MASTERCARD' | 'AMEX' | 'DISCOVER' | 'OTHER';

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  accountId?: string | null;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  institutionName?: string;

  @ApiPropertyOptional({
    enum: ['bank', 'credit_union', 'digital_wallet', 'broker', 'other'],
  })
  @IsOptional()
  @IsIn(['bank', 'credit_union', 'digital_wallet', 'broker', 'other'])
  institutionType?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 253 })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  institutionDomain?: string | null;

  @ApiPropertyOptional({ maxLength: 2 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  institutionCountry?: string;
}

export class EmailProductProposalInstitutionResponseDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({
    enum: ['bank', 'credit_union', 'digital_wallet', 'broker', 'other'],
  })
  type!: string;

  @ApiProperty({ nullable: true })
  domain!: string | null;

  @ApiProperty()
  country!: string;
}

export class EmailProductProposalDraftResponseDto {
  @ApiProperty({ enum: ['ACCOUNT', 'CARD'] })
  productType!: 'ACCOUNT' | 'CARD';

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: '5678' })
  lastFour!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: ['CHECKING', 'SAVINGS', 'INVESTMENT'], nullable: true })
  accountType!: 'CHECKING' | 'SAVINGS' | 'INVESTMENT' | null;

  @ApiProperty({ enum: ['CREDIT', 'DEBIT'], nullable: true })
  cardType!: 'CREDIT' | 'DEBIT' | null;

  @ApiProperty({
    enum: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER', 'OTHER'],
    nullable: true,
  })
  network!: 'VISA' | 'MASTERCARD' | 'AMEX' | 'DISCOVER' | 'OTHER' | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  accountId!: string | null;

  @ApiProperty({ type: EmailProductProposalInstitutionResponseDto })
  institution!: EmailProductProposalInstitutionResponseDto;

  @ApiProperty({
    description: 'Indica si hay un número completo cifrado en la propuesta.',
  })
  accountNumberProvided!: boolean;
}

export class EmailProductProposalEvidenceResponseDto {
  @ApiProperty({ format: 'uuid' })
  messageId!: string;

  @ApiProperty()
  fromDomain!: string;

  @ApiProperty()
  subject!: string;

  @ApiProperty({ format: 'date-time' })
  receivedAt!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  match!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class EmailProductProposalResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['ACCOUNT', 'CARD'] })
  productType!: 'ACCOUNT' | 'CARD';

  @ApiProperty({ enum: ['PENDING', 'APPROVING', 'APPROVED', 'DISCARDED'] })
  status!: 'PENDING' | 'APPROVING' | 'APPROVED' | 'DISCARDED';

  @ApiProperty({ type: EmailProductProposalDraftResponseDto })
  draft!: EmailProductProposalDraftResponseDto;

  @ApiProperty({ nullable: true, format: 'uuid' })
  approvedProductId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: [EmailProductProposalEvidenceResponseDto] })
  evidence!: EmailProductProposalEvidenceResponseDto[];

  @ApiPropertyOptional({
    type: 'object',
    properties: {
      duplicate: { type: 'boolean' },
      productId: { type: 'string', format: 'uuid' },
      reevaluatedSignals: { type: 'integer' },
    },
  })
  approval?: {
    duplicate: boolean;
    productId: string;
    reevaluatedSignals: number;
  };
}

export class DiscoverEmailProductProposalsResponseDto {
  @ApiProperty()
  scanned!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  limitReached!: boolean;

  @ApiProperty()
  created!: number;

  @ApiProperty()
  evidenceAdded!: number;

  @ApiProperty()
  ignored!: number;

  @ApiProperty({ type: [EmailProductProposalResponseDto] })
  proposals!: EmailProductProposalResponseDto[];
}
