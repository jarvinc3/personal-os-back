import type { Logger } from '@nestjs/common';
import type { ModuleSettingsReader } from '@personal-os/contracts';
import type { Prisma, PrismaService } from '@personal-os/database';
import {
  HOLDOUT_PARTITION,
  REVIEW_TARGET_TYPE,
} from '../evidence/email-evidence.constants';
import type { EmailReclassificationChunks } from './email-reclassification.chunks';
import { readEmailPartitions } from './email-reclassification.partitions';
import type { EmailReclassificationRuns } from './email-reclassification.runs';
import type {
  ReclassifiableMessage,
  ReclassifyScopeInput,
} from './email-reclassification.types';
import {
  RECLASSIFIABLE_STATUSES,
  RECLASSIFICATION_CLAIM_CHUNK_SIZE,
  RECLASSIFICATION_MAX_MESSAGES,
  type ReclassificationResult,
} from './email-reclassification.util';
import { loadEmailReviewSettings } from './email-review-settings';

type EmailReclassificationEngineDependencies = {
  prisma: PrismaService;
  runs: EmailReclassificationRuns;
  chunks: EmailReclassificationChunks;
  logger: Logger;
  moduleSettings?: ModuleSettingsReader;
};

/** Recorre un alcance en bloques y deja el run de análisis del pase. */
export class EmailReclassificationEngine {
  private readonly prisma: PrismaService;
  private readonly runs: EmailReclassificationRuns;
  private readonly chunks: EmailReclassificationChunks;
  private readonly logger: Logger;
  private readonly moduleSettings?: ModuleSettingsReader;

  constructor({
    prisma,
    runs,
    chunks,
    logger,
    moduleSettings,
  }: EmailReclassificationEngineDependencies) {
    this.prisma = prisma;
    this.runs = runs;
    this.chunks = chunks;
    this.logger = logger;
    this.moduleSettings = moduleSettings;
  }

  async run(input: ReclassifyScopeInput): Promise<ReclassificationResult> {
    const messages = await this.eligibleMessages(input);
    if (!messages.length) {
      return { requeued: 0 };
    }
    const reviewSettings = await loadEmailReviewSettings(
      this.moduleSettings,
      input.userId,
    );
    const runId = await this.runs.start({
      userId: input.userId,
      trigger: input.trigger,
      reviewConfidenceThreshold: reviewSettings.reviewConfidenceThreshold,
    });
    let requeued = 0;
    let skipped = 0;
    try {
      for (
        let start = 0;
        start < messages.length;
        start += RECLASSIFICATION_CLAIM_CHUNK_SIZE
      ) {
        const chunk = messages.slice(
          start,
          start + RECLASSIFICATION_CLAIM_CHUNK_SIZE,
        );
        const outcome = await this.chunks.reclassifyChunk({
          userId: input.userId,
          chunk,
          structural: input.structural,
          provenanceFor: input.provenanceFor,
          reviewSettings,
          verifiedSender: input.verifiedSender ?? false,
        });
        requeued += outcome.requeued;
        skipped += outcome.skipped;
      }
    } catch (error) {
      await this.runs.fail({ runId, requeued, skipped, error });
      throw error;
    }
    await this.runs.complete({ runId, requeued, skipped });
    this.logger.debug(
      `Reclassified ${requeued} messages for ${input.userId} (${input.trigger})`,
    );
    return { requeued };
  }

  async eligibleMessages({
    userId,
    where,
    matches,
  }: {
    userId: string;
    where: Prisma.AiEmailMessageWhereInput;
    matches: (message: ReclassifiableMessage) => boolean;
  }): Promise<ReclassifiableMessage[]> {
    const messages = await this.prisma.aiEmailMessage.findMany({
      where: {
        ...where,
        userId,
        processingStatus: { in: [...RECLASSIFIABLE_STATUSES] },
      },
      select: {
        id: true,
        receivedAt: true,
        fromAddress: true,
        subject: true,
        templateFingerprint: true,
        processingStatus: true,
        classification: true,
      },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: RECLASSIFICATION_MAX_MESSAGES,
    });
    const candidates = messages.filter(matches);
    if (!candidates.length) {
      return [];
    }
    const ids = candidates.map(({ id }) => id);
    const [verifications, partitionByMessage] = await Promise.all([
      this.prisma.aiHumanVerification.findMany({
        where: {
          userId,
          targetType: REVIEW_TARGET_TYPE,
          targetId: { in: ids },
        },
        distinct: ['targetId'],
        select: { targetId: true },
      }),
      readEmailPartitions({ prisma: this.prisma, userId, messageIds: ids }),
    ]);
    const verified = new Set(
      verifications.flatMap(({ targetId }) => (targetId ? [targetId] : [])),
    );
    return candidates.filter(
      (message) =>
        !verified.has(message.id) &&
        partitionByMessage.get(message.id) !== HOLDOUT_PARTITION,
    );
  }
}
