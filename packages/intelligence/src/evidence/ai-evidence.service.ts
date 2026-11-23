import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  MODULE_SETTINGS_READER,
  type ModuleSettingsReader,
} from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';
import { AiEmailReclassificationService } from '../email/email-reclassification.service';
import type { CreateHumanVerificationDto } from './dto/create-human-verification.dto';
import type { CreateReviewGroupVerificationDto } from './dto/create-review-group-verification.dto';
import type { CreateReviewSelectionVerificationDto } from './dto/create-review-selection-verification.dto';
import type { ReviewGroupsQueryDto } from './dto/review-groups-query.dto';
import type { ReviewQueueQueryDto } from './dto/review-queue-query.dto';
import { EmailAnalysisRuns } from './email-analysis-runs';
import { EmailEvidenceDataset } from './email-evidence-dataset';
import { EmailHumanVerificationWriter } from './email-human-verification.writer';
import { EmailReviewQueueReader } from './email-review-queue.reader';

@Injectable()
export class AiEvidenceService {
  private readonly logger = new Logger(AiEvidenceService.name);
  private readonly dataset: EmailEvidenceDataset;
  private readonly reviewQueueReader: EmailReviewQueueReader;
  private readonly verifications: EmailHumanVerificationWriter;
  private readonly runs: EmailAnalysisRuns;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reclassification: AiEmailReclassificationService,
    @Optional()
    @Inject(MODULE_SETTINGS_READER)
    private readonly moduleSettings?: ModuleSettingsReader,
  ) {
    this.dataset = new EmailEvidenceDataset(this.prisma);
    this.reviewQueueReader = new EmailReviewQueueReader({
      prisma: this.prisma,
      dataset: this.dataset,
      moduleSettings: this.moduleSettings,
    });
    this.verifications = new EmailHumanVerificationWriter({
      prisma: this.prisma,
      dataset: this.dataset,
      reclassification: this.reclassification,
      logger: this.logger,
    });
    this.runs = new EmailAnalysisRuns({
      prisma: this.prisma,
      dataset: this.dataset,
    });
  }

  datasetSummary(userId: string) {
    return this.dataset.summary(userId);
  }

  reviewQueue(userId: string, query: ReviewQueueQueryDto = {}) {
    return this.reviewQueueReader.reviewQueue(userId, query);
  }

  listReviewGroups(userId: string, query: ReviewGroupsQueryDto) {
    return this.reviewQueueReader.listReviewGroups(userId, query);
  }

  verifyReviewGroup(userId: string, dto: CreateReviewGroupVerificationDto) {
    return this.verifications.verifyReviewGroup(userId, dto);
  }

  verifyReviewSelection(
    userId: string,
    dto: CreateReviewSelectionVerificationDto,
  ) {
    return this.verifications.verifyReviewSelection(userId, dto);
  }

  verifyMessage(
    userId: string,
    messageId: string,
    dto: CreateHumanVerificationDto,
  ) {
    return this.verifications.verifyMessage(userId, messageId, dto);
  }

  startAnalysisRun(
    userId: string,
    mode: 'ANALYZE_ONLY' | 'EVALUATE' | 'IMPORT',
    configuration: Record<string, unknown>,
  ) {
    return this.runs.startAnalysisRun(userId, mode, configuration);
  }

  completeAnalysisRun(
    userId: string,
    runId: string,
    outcome: { metrics?: Record<string, unknown>; error?: string },
  ) {
    return this.runs.completeAnalysisRun(userId, runId, outcome);
  }

  recordObservation(input: {
    userId: string;
    runId?: string;
    knowledgeType: string;
    knowledgeKey: string;
    proposedScope: string;
    sourceType: string;
    sourceId: string;
    payload: Record<string, unknown>;
    weight?: number;
  }) {
    return this.runs.recordObservation(input);
  }

  listRuns(userId: string) {
    return this.runs.listRuns(userId);
  }

  evaluateHoldout(userId: string) {
    return this.runs.evaluateHoldout(userId);
  }

  compareRuns(userId: string, firstId: string, secondId: string) {
    return this.runs.compareRuns(userId, firstId, secondId);
  }
}
