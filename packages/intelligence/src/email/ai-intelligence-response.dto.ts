import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HUMAN_VERIFICATION_VERDICTS } from '../evidence/human-verification.constants';
import { AI_ROLES } from '../roles/ai-role.decorator';

const EMAIL_PROCESSING_STATUSES = [
  'INGESTED',
  'QUEUED',
  'PROCESSED',
  'REVIEW_REQUIRED',
  'FAILED',
] as const;
const DIAGNOSTIC_STATUSES = ['ready', 'missing_oauth_configuration'] as const;
const SYNC_STATUSES = [
  'running',
  'waiting',
  'retrying',
  'scheduled',
  'completed',
  'failed',
] as const;
const SYNC_PHASES = [
  'bootstrap',
  'incremental',
  'recovery',
  'classifying',
] as const;
const SYNC_ERROR_CATEGORIES = [
  'authorization',
  'configuration',
  'rate_limit',
  'temporary',
  'unknown',
] as const;
const SYNC_ATTEMPT_RESULTS = ['SUCCEEDED', 'FAILED', 'INTERRUPTED'] as const;

export class AiEmailSyncProgressResponseDto {
  @ApiProperty({ enum: SYNC_STATUSES })
  status!: string;

  @ApiProperty({ enum: SYNC_PHASES })
  phase!: string;

  @ApiProperty()
  attempt!: number;

  @ApiPropertyOptional({ type: Number })
  rateLimitRetryCount?: number;

  @ApiProperty()
  processedThisRun!: number;

  @ApiProperty()
  importedThisRun!: number;

  @ApiPropertyOptional({ type: Number })
  batchSize?: number;

  @ApiPropertyOptional({ type: Number })
  totalEstimate?: number;

  @ApiPropertyOptional({ type: Number })
  retryAt?: number;

  @ApiPropertyOptional({ type: Number })
  nextRunAt?: number;

  @ApiPropertyOptional({ type: String })
  errorCode?: string;

  @ApiPropertyOptional({ type: String })
  providerErrorCode?: string;

  @ApiPropertyOptional({
    type: 'object',
    properties: { from: { type: 'string' }, to: { type: 'string' } },
  })
  recoveryRange?: { from: string; to: string };

  @ApiPropertyOptional({ enum: SYNC_ERROR_CATEGORIES })
  errorCategory?: string;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AiEmailLastAttemptResponseDto {
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  startedAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  finishedAt!: string | null;

  @ApiProperty({ enum: SYNC_ATTEMPT_RESULTS, nullable: true })
  result!: string | null;

  @ApiProperty({ nullable: true, type: String })
  errorCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  errorCategory!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  importedCount!: number | null;

  @ApiProperty({ nullable: true, type: String })
  phase!: string | null;
}

export class AiEmailLastFailureResponseDto {
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  finishedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  errorCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  errorCategory!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  importedCount!: number | null;

  @ApiProperty({ nullable: true, type: String })
  phase!: string | null;
}

export class AiEmailConnectionResponseDto {
  @ApiProperty()
  connected!: boolean;

  @ApiPropertyOptional({ type: String })
  emailAddress?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
  })
  initialSyncCompletedAt?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
  })
  lastSyncedAt?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
  })
  lastRecoverySyncAt?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  lastSyncErrorCode?: string | null;

  @ApiPropertyOptional({
    type: () => AiEmailLastAttemptResponseDto,
    nullable: true,
  })
  lastAttempt?: AiEmailLastAttemptResponseDto | null;

  @ApiPropertyOptional({
    type: () => AiEmailLastFailureResponseDto,
    nullable: true,
  })
  lastFailure?: AiEmailLastFailureResponseDto | null;

  @ApiPropertyOptional({ type: Boolean })
  requiresReconnect?: boolean;

  @ApiPropertyOptional({
    type: () => AiEmailSyncProgressResponseDto,
    nullable: true,
  })
  syncProgress?: AiEmailSyncProgressResponseDto | null;

  @ApiPropertyOptional({ type: Boolean })
  syncInProgress?: boolean;
}

export class AiEmailCountersResponseDto {
  @ApiProperty()
  importedMessages!: number;

  @ApiProperty()
  recentMessages!: number;

  @ApiProperty()
  bootstrapImportedMessages!: number;
}

export class AiEmailReceivedRangeResponseDto {
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  firstMessageAt!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  latestMessageAt!: string | null;
}

export class AiEmailDashboardResponseDto {
  @ApiProperty({ type: () => AiEmailConnectionResponseDto })
  connection!: AiEmailConnectionResponseDto;

  @ApiProperty({ type: () => AiEmailCountersResponseDto })
  counters!: AiEmailCountersResponseDto;

  @ApiProperty({ type: () => AiEmailReceivedRangeResponseDto })
  receivedRange!: AiEmailReceivedRangeResponseDto;

  @ApiProperty({ enum: AI_ROLES })
  role!: string;
}

export class AiEmailMessageSummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'date-time' })
  receivedAt!: string;

  @ApiProperty()
  fromAddress!: string;

  @ApiProperty()
  fromDomain!: string;

  @ApiProperty()
  subject!: string;

  @ApiProperty({ enum: EMAIL_PROCESSING_STATUSES })
  processingStatus!: string;

  @ApiProperty()
  contentFingerprint!: string;
}

export class AiEmailMessagePageResponseDto {
  @ApiProperty({ type: () => [AiEmailMessageSummaryResponseDto] })
  items!: AiEmailMessageSummaryResponseDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class AiEmailContentResponseDto {
  @ApiProperty()
  messageId!: string;

  @ApiProperty({ nullable: true, type: String })
  rawBody!: string | null;

  @ApiProperty({ nullable: true, type: String })
  sanitizedBody!: string | null;

  @ApiProperty({ nullable: true, type: String })
  canonicalBody!: string | null;

  @ApiProperty({ nullable: true, type: String })
  snippet!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  retentionExpiresAt!: string | null;
}

export class AiKnowledgeObservationResponseDto {
  @ApiProperty({ example: '1' })
  sequence!: string;

  @ApiProperty({ nullable: true, type: String })
  runId!: string | null;

  @ApiProperty()
  knowledgeType!: string;

  @ApiProperty()
  knowledgeKey!: string;

  @ApiProperty()
  proposedScope!: string;

  @ApiProperty({ type: Object, nullable: true })
  payload!: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AiHumanVerificationResponseDto {
  @ApiProperty({ example: '1' })
  sequence!: string;

  @ApiProperty({ enum: AI_ROLES })
  verifierRole!: string;

  @ApiProperty({ enum: HUMAN_VERIFICATION_VERDICTS })
  verdict!: string;

  @ApiProperty({ type: Object, nullable: true })
  correctedPayload!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;

  @ApiProperty()
  isGroundTruth!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AiEmailMessageProvenanceResponseDto {
  @ApiProperty({ type: () => [AiKnowledgeObservationResponseDto] })
  observations!: AiKnowledgeObservationResponseDto[];

  @ApiProperty({ type: () => [AiHumanVerificationResponseDto] })
  verifications!: AiHumanVerificationResponseDto[];
}

export class AiEmailClassificationResponseDto {
  @ApiProperty()
  route!: string;

  @ApiProperty()
  relevance!: boolean;

  @ApiProperty()
  semanticType!: string;

  @ApiProperty({ nullable: true, type: Object })
  transaction!: Record<string, unknown> | null;

  @ApiProperty({ minimum: 0, maximum: 1 })
  confidence!: number;

  @ApiProperty()
  decisionPath!: string;

  @ApiProperty({ type: [Object] })
  knowledgeUsed!: Array<Record<string, unknown>>;

  @ApiProperty({ nullable: true, type: String })
  provider!: string | null;

  @ApiProperty({ nullable: true, type: String })
  model!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class AiEmailMessageResponseDto extends AiEmailMessageSummaryResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty()
  providerMessageId!: string;

  @ApiProperty({ nullable: true, type: String })
  providerThreadId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  templateFingerprint!: string | null;

  @ApiProperty({ type: Object, nullable: true })
  classification!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: String })
  classificationPath!: string | null;

  @ApiProperty({ nullable: true, type: String })
  classificationProvider!: string | null;

  @ApiProperty({ nullable: true, type: String })
  classificationModel!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: () => AiEmailContentResponseDto, nullable: true })
  content!: AiEmailContentResponseDto | null;

  @ApiProperty({ type: () => AiEmailMessageProvenanceResponseDto })
  provenance!: AiEmailMessageProvenanceResponseDto;

  @ApiProperty({ type: () => [AiEmailClassificationResponseDto] })
  classifications!: AiEmailClassificationResponseDto[];
}

export class AiEmailConnectResponseDto {
  @ApiProperty()
  authorizationUrl!: string;
}

export class AiEmailSyncResponseDto {
  @ApiProperty()
  connected!: boolean;

  @ApiProperty()
  syncStarted!: boolean;
}

export class AiEmailResetResponseDto {
  @ApiProperty()
  connected!: boolean;

  @ApiProperty()
  deletedMessages!: number;
}

export class AiEmailDiagnosticsResponseDto {
  @ApiProperty()
  configured!: boolean;

  @ApiProperty({ example: 'GMAIL' })
  provider!: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiProperty({ enum: DIAGNOSTIC_STATUSES })
  status!: string;
}

const SAMPLE_SELECTION_MODES = ['IDS', 'SENDER_WINDOW'] as const;
const SAMPLE_ITEM_STATUSES = ['INCLUDED', 'NOT_FOUND'] as const;
const SAMPLE_OUTCOMES = [
  'APPLIED',
  'ALREADY_APPLIED',
  'REVIEW_REQUIRED',
  'REJECTED',
  'UNAVAILABLE',
] as const;
const SAMPLE_CLASSIFICATION_METHODS = [
  'KNOWLEDGE',
  'DETERMINISTIC',
  'MODEL',
] as const;

export class AiEmailSampleSignalDto {
  @ApiProperty()
  published!: boolean;

  @ApiPropertyOptional()
  reason?: string;
}

export class AiEmailSampleClassificationDto {
  @ApiProperty()
  semanticType!: string;

  @ApiProperty()
  confidence!: number;

  @ApiProperty({ enum: SAMPLE_CLASSIFICATION_METHODS })
  method!: string;

  @ApiProperty({ nullable: true, type: String })
  movementClass!: string | null;

  @ApiProperty({ nullable: true, type: String })
  kind!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  amount!: number | null;

  @ApiProperty({ nullable: true, type: String })
  currency!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  transactionDate!: string | null;

  @ApiProperty({ nullable: true, type: String })
  direction!: string | null;
}

export class AiEmailSampleHintsDto {
  @ApiProperty({ nullable: true, type: String })
  bankReference!: string | null;

  @ApiProperty({ nullable: true, type: String })
  merchant!: string | null;

  @ApiProperty({ nullable: true, type: String })
  last4!: string | null;
}

export class AiEmailSampleMovementDto {
  @ApiProperty({ nullable: true, type: String })
  accountId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cardId!: string | null;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: ['DEBIT', 'CREDIT'] })
  type!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ format: 'date-time' })
  transactionDate!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  legRole!: string | null;

  @ApiProperty({ nullable: true, type: String })
  externalReference!: string | null;

  @ApiProperty()
  importReference!: string;
}

export class AiEmailSampleCardPaymentDto {
  @ApiProperty()
  sourceAccountId!: string;

  @ApiProperty()
  cardId!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ format: 'date-time' })
  transactionDate!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ nullable: true, type: String })
  externalReference!: string | null;

  @ApiProperty()
  importReference!: string;
}

export class AiEmailSamplePredictionDto {
  @ApiProperty({ enum: SAMPLE_OUTCOMES })
  outcome!: string;

  @ApiPropertyOptional()
  reason?: string;

  @ApiPropertyOptional({ type: () => AiEmailSampleMovementDto })
  movement?: AiEmailSampleMovementDto;

  @ApiPropertyOptional({ type: () => AiEmailSampleCardPaymentDto })
  cardPayment?: AiEmailSampleCardPaymentDto;
}

export class AiEmailSampleExecutionDto {
  @ApiProperty({ enum: SAMPLE_OUTCOMES })
  outcome!: string;

  @ApiPropertyOptional()
  reason?: string;

  @ApiProperty({ nullable: true, type: String })
  transactionId!: string | null;
}

export class AiEmailSampleItemDto {
  @ApiProperty()
  messageId!: string;

  @ApiProperty({ enum: SAMPLE_ITEM_STATUSES })
  status!: string;

  @ApiProperty({ nullable: true, type: String })
  fromAddress!: string | null;

  @ApiProperty({ nullable: true, type: String })
  fromDomain!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  receivedAt!: string | null;

  @ApiProperty({ type: () => AiEmailSampleClassificationDto, nullable: true })
  classification!: AiEmailSampleClassificationDto | null;

  @ApiPropertyOptional()
  classificationUnavailableReason?: string;

  @ApiProperty({ type: () => AiEmailSampleHintsDto, nullable: true })
  hints!: AiEmailSampleHintsDto | null;

  @ApiProperty({ type: () => AiEmailSampleSignalDto })
  signal!: AiEmailSampleSignalDto;

  @ApiProperty({ type: () => AiEmailSamplePredictionDto, nullable: true })
  prediction!: AiEmailSamplePredictionDto | null;

  @ApiPropertyOptional({ type: () => AiEmailSampleExecutionDto })
  execution?: AiEmailSampleExecutionDto;
}

export class AiEmailSampleSelectionDto {
  @ApiProperty({ enum: SAMPLE_SELECTION_MODES })
  mode!: string;

  @ApiProperty()
  requested!: number;

  @ApiProperty()
  included!: number;

  @ApiProperty()
  cap!: number;

  @ApiPropertyOptional()
  sender?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  dateTo?: string;
}

export class AiEmailSampleExecutedDto {
  @ApiProperty()
  applied!: number;

  @ApiProperty()
  alreadyApplied!: number;

  @ApiProperty()
  reviewRequired!: number;

  @ApiProperty()
  rejected!: number;
}

export class AiEmailSampleSummaryDto {
  @ApiProperty()
  included!: number;

  @ApiProperty()
  notFound!: number;

  @ApiPropertyOptional()
  wouldPublishSignal?: number;

  @ApiPropertyOptional()
  wouldCreateMovement?: number;

  @ApiPropertyOptional()
  reviewRequired?: number;

  @ApiPropertyOptional({ type: () => AiEmailSampleExecutedDto })
  executed?: AiEmailSampleExecutedDto;
}

export class AiEmailSampleImportResponseDto {
  @ApiProperty()
  dryRun!: boolean;

  @ApiProperty({ type: () => AiEmailSampleSelectionDto })
  selection!: AiEmailSampleSelectionDto;

  @ApiProperty({ type: () => AiEmailSampleSummaryDto })
  summary!: AiEmailSampleSummaryDto;

  @ApiProperty({ type: () => [AiEmailSampleItemDto] })
  items!: AiEmailSampleItemDto[];
}
