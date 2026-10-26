import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import {
  SEMANTIC_ROUTES,
  SEMANTIC_TYPES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_KINDS,
} from '../../evidence/human-verification.constants';

export const KNOWLEDGE_SCOPES = ['GLOBAL', 'USER'] as const;
export const KNOWLEDGE_TYPES = [
  'EMAIL_SENDER',
  'EMAIL_DOMAIN',
  'EMAIL_TEMPLATE',
  'ENTITY',
  'RELATION',
  'USER_MAPPING',
] as const;
export const KNOWLEDGE_STATES = [
  'OBSERVED',
  'STABLE',
  'REVIEW_REQUIRED',
  'BLOCKED',
] as const;
export const KNOWLEDGE_PROMOTIONS = ['AUTO', 'CONTRIBUTOR', 'ADMIN'] as const;

export class KnowledgeTransactionDto {
  @ApiPropertyOptional({
    enum: TRANSACTION_KINDS,
    description: 'Siempre presente en GLOBAL; el resto es privado de USER.',
  })
  kind?: (typeof TRANSACTION_KINDS)[number];

  @ApiPropertyOptional({ type: Number, minimum: 0, exclusiveMinimum: true })
  amount?: number;

  @ApiPropertyOptional({ example: 'DOP' })
  currency?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  transactionDate?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_DIRECTIONS })
  direction?: (typeof TRANSACTION_DIRECTIONS)[number];

  @ApiPropertyOptional()
  merchant?: string;

  @ApiPropertyOptional()
  bankReference?: string;

  @ApiPropertyOptional({ example: '4821', pattern: '^\\d{4}$' })
  last4?: string;
}

export class KnowledgeLabelDto {
  @ApiPropertyOptional({ type: Boolean })
  relevance?: boolean;

  @ApiPropertyOptional({ enum: SEMANTIC_TYPES })
  semanticType?: (typeof SEMANTIC_TYPES)[number];

  @ApiPropertyOptional({ enum: SEMANTIC_ROUTES, isArray: true })
  routes?: Array<(typeof SEMANTIC_ROUTES)[number]>;

  @ApiPropertyOptional({ type: KnowledgeTransactionDto })
  transaction?: KnowledgeTransactionDto;
}

export class KnowledgePayloadDto {
  @ApiProperty({ type: KnowledgeLabelDto })
  label!: KnowledgeLabelDto;
}

export class KnowledgeItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: KNOWLEDGE_SCOPES })
  scope!: (typeof KNOWLEDGE_SCOPES)[number];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Solo en USER; GLOBAL siempre devuelve null.',
  })
  userId?: string | null;

  @ApiProperty({ enum: KNOWLEDGE_TYPES })
  knowledgeType!: (typeof KNOWLEDGE_TYPES)[number];

  @ApiProperty()
  knowledgeKey!: string;

  @ApiProperty({ enum: KNOWLEDGE_STATES })
  state!: (typeof KNOWLEDGE_STATES)[number];

  @ApiProperty({ type: KnowledgePayloadDto })
  payload!: KnowledgePayloadDto;

  @ApiProperty()
  messagesSeen!: number;

  @ApiProperty()
  rejectedMessages!: number;

  @ApiProperty()
  distinctUsers!: number;

  @ApiProperty()
  humanVerifiedCount!: number;

  @ApiPropertyOptional({ enum: KNOWLEDGE_PROMOTIONS, nullable: true })
  promotedBy?: (typeof KNOWLEDGE_PROMOTIONS)[number] | null;

  @ApiProperty()
  projectorVersion!: string;

  @ApiProperty()
  policyVersion!: string;

  @ApiProperty()
  normalizerVersion!: string;

  @ApiProperty()
  sanitizerVersion!: string;

  @ApiProperty({ format: 'date-time' })
  firstSeenAt!: string;

  @ApiProperty({ format: 'date-time' })
  lastSeenAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class KnowledgeExplorerDto {
  @ApiProperty({ type: [KnowledgeItemDto] })
  personal!: KnowledgeItemDto[];

  @ApiProperty({ type: [KnowledgeItemDto] })
  global!: KnowledgeItemDto[];
}

export class KnowledgeRebuildDto {
  @ApiProperty()
  runId!: string;

  @ApiProperty({
    example: '42',
    description: 'Secuencia BigInt como string decimal.',
  })
  observationSequence!: string;

  @ApiProperty({
    example: '42',
    description: 'Secuencia BigInt como string decimal.',
  })
  verificationSequence!: string;

  @ApiProperty({
    example: '7',
    description: 'Secuencia BigInt como string decimal.',
  })
  consentRevision!: string;

  @ApiProperty()
  items!: number;
}

export class KnowledgeDeletionDto {
  @ApiProperty({ example: true })
  deleted!: boolean;

  @ApiProperty()
  deletedMessages!: number;

  @ApiProperty()
  detachedVerifications!: number;

  @ApiProperty()
  detachedObservations!: number;
}

export class ConfirmAiDataDeletionDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  confirmed!: boolean;
}
