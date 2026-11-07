import { ApiProperty } from '@nestjs/swagger';
import { HUMAN_VERIFICATION_VERDICTS } from './human-verification.constants';
import {
  REVIEW_QUEUE_PARTITIONS,
  REVIEW_QUEUE_STATUSES,
} from './review-queue.constants';
import { AI_ROLES } from '../roles/ai-role.decorator';

const ANALYSIS_MODES = ['ANALYZE_ONLY', 'EVALUATE', 'IMPORT'] as const;
const RUN_STATUSES = ['RUNNING', 'COMPLETED', 'FAILED'] as const;
const REPRODUCTION_STATUSES = ['COMPLETE', 'INCOMPLETE'] as const;

export class AiDatasetPartitionsResponseDto {
  @ApiProperty()
  TRAIN!: number;

  @ApiProperty()
  VALIDATION!: number;

  @ApiProperty()
  HOLDOUT!: number;
}

export class AiDatasetResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: () => AiDatasetPartitionsResponseDto })
  partitions!: AiDatasetPartitionsResponseDto;
}

export class AiReviewItemVerificationResponseDto {
  @ApiProperty({ enum: HUMAN_VERIFICATION_VERDICTS })
  verdict!: string;

  @ApiProperty({ type: Object, nullable: true })
  labels!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AiReviewQueueItemResponseDto {
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

  @ApiProperty()
  contentFingerprint!: string;

  @ApiProperty()
  processingStatus!: string;

  @ApiProperty({ enum: REVIEW_QUEUE_PARTITIONS })
  partition!: string;

  @ApiProperty({ enum: REVIEW_QUEUE_STATUSES })
  status!: string;

  @ApiProperty({
    type: () => AiReviewItemVerificationResponseDto,
    nullable: true,
  })
  verification!: AiReviewItemVerificationResponseDto | null;
}

export class AiReviewQueueCountsResponseDto {
  @ApiProperty()
  all!: number;

  @ApiProperty()
  TRAIN!: number;

  @ApiProperty()
  VALIDATION!: number;

  @ApiProperty()
  HOLDOUT!: number;
}

export class AiReviewQueueResponseDto {
  @ApiProperty({ type: () => [AiReviewQueueItemResponseDto] })
  items!: AiReviewQueueItemResponseDto[];

  @ApiProperty({ type: () => AiReviewQueueCountsResponseDto })
  counts!: AiReviewQueueCountsResponseDto;

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class AiReviewGroupResponseDto {
  @ApiProperty()
  fromAddress!: string;

  @ApiProperty({ nullable: true, type: String })
  templateFingerprint!: string | null;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  pending!: number;

  @ApiProperty()
  pendingHoldout!: number;

  @ApiProperty({ type: [String] })
  sampleSubjects!: string[];

  @ApiProperty({ type: [String] })
  sampleMessageIds!: string[];
}

export class AiReviewGroupsPageResponseDto {
  @ApiProperty({ type: () => [AiReviewGroupResponseDto] })
  items!: AiReviewGroupResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  totalGroups!: number;

  @ApiProperty()
  hasMore!: boolean;
}

export class AiReviewGroupVerificationResultResponseDto {
  @ApiProperty()
  verified!: number;

  @ApiProperty()
  holdoutExcluded!: number;

  @ApiProperty()
  alreadyVerified!: number;

  @ApiProperty({
    description:
      'Correos del mismo remitente reencolados y reclasificados con la etiqueta verificada.',
  })
  requeued!: number;
}

export class AiMessageVerificationResponseDto {
  @ApiProperty({ example: '1' })
  sequence!: string;

  @ApiProperty({ enum: AI_ROLES })
  verifierRole!: string;

  @ApiProperty()
  targetType!: string;

  @ApiProperty({ nullable: true, type: String })
  targetId!: string | null;

  @ApiProperty({ enum: HUMAN_VERIFICATION_VERDICTS })
  verdict!: string;

  @ApiProperty({ type: Object, nullable: true })
  correctedPayload!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;

  @ApiProperty()
  isGroundTruth!: boolean;

  @ApiProperty({
    description:
      'Correos del mismo remitente reencolados y reclasificados con la etiqueta verificada.',
  })
  requeued!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AiAnalysisRunResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  datasetId!: string;

  @ApiProperty({ enum: ANALYSIS_MODES })
  mode!: string;

  @ApiProperty({ enum: RUN_STATUSES })
  status!: string;

  @ApiProperty({ example: '1' })
  observationSequence!: string;

  @ApiProperty({ example: '1' })
  verificationSequence!: string;

  @ApiProperty({ example: '1' })
  consentRevision!: string;

  @ApiProperty({ enum: REPRODUCTION_STATUSES })
  reproductionStatus!: string;

  @ApiProperty({ type: Object })
  missingEvidence!: Record<string, unknown>;

  @ApiProperty()
  projectorVersion!: string;

  @ApiProperty()
  policyVersion!: string;

  @ApiProperty()
  pipelineVersion!: string;

  @ApiProperty({ nullable: true, type: String })
  detectorVersion!: string | null;

  @ApiProperty({ nullable: true, type: String })
  promptVersion!: string | null;

  @ApiProperty({ nullable: true, type: String })
  schemaVersion!: string | null;

  @ApiProperty({ type: Object })
  configuration!: Record<string, unknown>;

  @ApiProperty({ type: Object, nullable: true })
  metrics!: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  completedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  error!: string | null;
}
