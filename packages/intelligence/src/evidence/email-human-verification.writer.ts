import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma, PrismaService } from '@personal-os/database';
import type { AiEmailReclassificationService } from '../email/email-reclassification.service';
import {
  verificationLabel,
  type ReclassificationResult,
} from '../email/email-reclassification.util';
import type { CreateHumanVerificationDto } from './dto/create-human-verification.dto';
import type { CreateReviewGroupVerificationDto } from './dto/create-review-group-verification.dto';
import type { CreateReviewSelectionVerificationDto } from './dto/create-review-selection-verification.dto';
import type { EmailEvidenceDataset } from './email-evidence-dataset';
import {
  EMAIL_SOURCE_TYPE,
  REVIEW_TARGET_TYPE,
} from './email-evidence.constants';
import {
  HUMAN_VERIFICATION_SELECTION_MAX_MESSAGES,
  HUMAN_VERIFICATION_VERDICTS,
} from './human-verification.constants';
import {
  assertHumanVerificationLabels,
  humanVerificationPayload,
} from './human-verification.validation';

const VERIFICATION_SELECT = {
  sequence: true,
  verifierRole: true,
  targetType: true,
  targetId: true,
  verdict: true,
  correctedPayload: true,
  notes: true,
  isGroundTruth: true,
  createdAt: true,
} as const;

type EmailHumanVerificationWriterDependencies = {
  prisma: PrismaService;
  dataset: EmailEvidenceDataset;
  reclassification: AiEmailReclassificationService;
  logger: Logger;
};

/**
 * Registra la verificación humana de un grupo, una selección o un correo y
 * vuelve a encolar lo afectado. Repetir la misma verificación no duplica filas.
 */
export class EmailHumanVerificationWriter {
  private readonly prisma: PrismaService;
  private readonly dataset: EmailEvidenceDataset;
  private readonly reclassification: AiEmailReclassificationService;
  private readonly logger: Logger;

  constructor({
    prisma,
    dataset,
    reclassification,
    logger,
  }: EmailHumanVerificationWriterDependencies) {
    this.prisma = prisma;
    this.dataset = dataset;
    this.reclassification = reclassification;
    this.logger = logger;
  }

  async verifyReviewGroup(
    userId: string,
    dto: CreateReviewGroupVerificationDto,
  ) {
    assertHumanVerificationLabels(dto);
    const dataset = await this.dataset.prepare(userId);
    const messages = await this.prisma.aiEmailMessage.findMany({
      where: {
        userId,
        fromAddress: dto.fromAddress,
        templateFingerprint: dto.templateFingerprint ?? null,
      },
      select: { id: true },
    });
    if (!messages.length) {
      throw new NotFoundException('Grupo de revisión no encontrado');
    }
    const messageIds = messages.map(({ id }) => id);
    const [items, roleAssignment] = await Promise.all([
      this.prisma.aiDatasetItem.findMany({
        where: {
          datasetId: dataset.id,
          userId,
          sourceType: EMAIL_SOURCE_TYPE,
          sourceId: { in: messageIds },
        },
        select: { sourceId: true, partition: true },
      }),
      this.prisma.userRole.findUnique({
        where: { userId },
        select: { role: true },
      }),
    ]);
    const partitionByMessageId = new Map(
      items.map(({ sourceId, partition }) => [sourceId, partition]),
    );
    const groupMessages = messages.flatMap(({ id }) => {
      const partition = partitionByMessageId.get(id);
      return partition ? [{ id, partition }] : [];
    });
    const verifierRole = roleAssignment?.role ?? 'USER';
    const correctedPayload = humanVerificationPayload(dto);
    const notes = dto.notes?.trim() || null;
    const groupKey = reviewGroupKey(
      dto.fromAddress,
      dto.templateFingerprint ?? null,
    );
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockReviewGroup(tx, { userId, groupKey });
      const verifications = await tx.aiHumanVerification.findMany({
        where: {
          userId,
          targetType: REVIEW_TARGET_TYPE,
          targetId: { in: groupMessages.map(({ id }) => id) },
        },
        distinct: ['targetId'],
        select: { targetId: true },
      });
      const verifiedMessageIds = new Set(
        verifications.flatMap(({ targetId }) => (targetId ? [targetId] : [])),
      );
      const pending = groupMessages.filter(
        ({ id, partition }) =>
          !verifiedMessageIds.has(id) && partition !== 'HOLDOUT',
      );
      const alreadyVerified = groupMessages.filter(({ id }) =>
        verifiedMessageIds.has(id),
      ).length;
      const holdoutExcluded = groupMessages.filter(
        ({ id, partition }) =>
          !verifiedMessageIds.has(id) && partition === 'HOLDOUT',
      ).length;
      if (pending.length) {
        await tx.aiHumanVerification.createMany({
          data: pending.map(({ id }) => ({
            userId,
            verifierRole,
            targetType: REVIEW_TARGET_TYPE,
            targetId: id,
            verdict: dto.verdict,
            correctedPayload: correctedPayload as never,
            notes,
            isGroundTruth: false,
          })),
        });
      }
      return {
        verified: pending.length,
        holdoutExcluded,
        alreadyVerified,
      };
    });
    const requeued = await this.reclassifyAfterVerification(
      () =>
        this.reclassification.reclassifyAfterReviewGroupVerification({
          userId,
          fromAddress: dto.fromAddress,
          templateFingerprint: dto.templateFingerprint ?? null,
          correctedLabel: verificationLabel({
            verdict: dto.verdict,
            correctedPayload: correctedPayload ?? null,
          }),
        }),
      `review group ${dto.fromAddress}`,
    );
    return { ...outcome, requeued };
  }

  async verifyReviewSelection(
    userId: string,
    dto: CreateReviewSelectionVerificationDto,
  ) {
    if (
      !Array.isArray(dto.messageIds) ||
      dto.messageIds.length === 0 ||
      dto.messageIds.length > HUMAN_VERIFICATION_SELECTION_MAX_MESSAGES ||
      dto.messageIds.some(
        (messageId) =>
          typeof messageId !== 'string' ||
          messageId.trim().length === 0 ||
          messageId.length > 512,
      ) ||
      new Set(dto.messageIds).size !== dto.messageIds.length
    ) {
      throw new BadRequestException(
        `Selecciona entre 1 y ${HUMAN_VERIFICATION_SELECTION_MAX_MESSAGES} correos sin repetir`,
      );
    }
    if (
      !(HUMAN_VERIFICATION_VERDICTS as readonly string[]).includes(dto.verdict)
    ) {
      throw new BadRequestException('Veredicto de revisión inválido');
    }
    assertHumanVerificationLabels(dto);

    const messageIds = [...dto.messageIds];
    const messages = await this.prisma.aiEmailMessage.findMany({
      where: { userId, id: { in: messageIds } },
      select: { id: true, fromAddress: true, templateFingerprint: true },
    });
    if (messages.length !== messageIds.length) {
      throw new NotFoundException('Uno o más correos no se encontraron');
    }

    const dataset = await this.dataset.prepare(userId);
    const items = await this.prisma.aiDatasetItem.findMany({
      where: {
        datasetId: dataset.id,
        userId,
        sourceType: EMAIL_SOURCE_TYPE,
        sourceId: { in: messageIds },
      },
      select: { sourceId: true, partition: true },
    });
    const partitionByMessageId = new Map(
      items.map(({ sourceId, partition }) => [sourceId, partition]),
    );
    if (messageIds.some((id) => !partitionByMessageId.has(id))) {
      throw new NotFoundException('Uno o más correos no se encontraron');
    }

    const roleAssignment = await this.prisma.userRole.findUnique({
      where: { userId },
      select: { role: true },
    });
    const verifierRole = roleAssignment?.role ?? 'USER';
    const correctedPayload = humanVerificationPayload(dto);
    const notes = dto.notes?.trim() || null;
    const groupKeys = [
      ...new Set(
        messages.map(({ fromAddress, templateFingerprint }) =>
          reviewGroupKey(fromAddress, templateFingerprint ?? null),
        ),
      ),
    ].sort();

    const outcome = await this.prisma.$transaction(async (tx) => {
      for (const groupKey of groupKeys) {
        await lockReviewGroup(tx, { userId, groupKey });
      }
      const existing = await tx.aiHumanVerification.findMany({
        where: {
          userId,
          targetType: REVIEW_TARGET_TYPE,
          targetId: { in: messageIds },
        },
        orderBy: [{ targetId: 'asc' }, { sequence: 'desc' }],
        select: VERIFICATION_SELECT,
      });
      const latestByTargetId = new Map<string, (typeof existing)[number]>();
      for (const verification of existing) {
        if (
          verification.targetId &&
          !latestByTargetId.has(verification.targetId)
        ) {
          latestByTargetId.set(verification.targetId, verification);
        }
      }

      const toCreate = [] as Array<{
        userId: string;
        verifierRole: string;
        targetType: string;
        targetId: string;
        verdict: string;
        correctedPayload: Record<string, unknown> | undefined;
        notes: string | null;
        isGroundTruth: boolean;
      }>;
      let alreadyVerified = 0;
      for (const messageId of messageIds) {
        const latestVerification = latestByTargetId.get(messageId) ?? null;
        if (
          this.retryVerification({
            latestVerification,
            verdict: dto.verdict,
            correctedPayload,
            notes,
          })
        ) {
          alreadyVerified += 1;
          continue;
        }
        toCreate.push({
          userId,
          verifierRole,
          targetType: REVIEW_TARGET_TYPE,
          targetId: messageId,
          verdict: dto.verdict,
          correctedPayload,
          notes,
          isGroundTruth: partitionByMessageId.get(messageId) === 'HOLDOUT',
        });
      }
      if (toCreate.length) {
        await tx.aiHumanVerification.createMany({
          data: toCreate as never,
        });
      }
      return { verified: toCreate.length, alreadyVerified };
    });

    const correctedLabel = verificationLabel({
      verdict: dto.verdict,
      correctedPayload: correctedPayload ?? null,
    });
    const reclassificationGroups = new Map<
      string,
      { fromAddress: string; templateFingerprint: string }
    >();
    for (const { fromAddress, templateFingerprint } of messages) {
      if (templateFingerprint) {
        reclassificationGroups.set(
          JSON.stringify([fromAddress, templateFingerprint]),
          { fromAddress, templateFingerprint },
        );
      }
    }
    let requeued = 0;
    for (const {
      fromAddress,
      templateFingerprint,
    } of reclassificationGroups.values()) {
      const result = await this.reclassifyAfterVerification(
        () =>
          this.reclassification.reclassifyAfterReviewGroupVerification({
            userId,
            fromAddress,
            templateFingerprint,
            correctedLabel,
          }),
        `review selection ${fromAddress}`,
      );
      requeued += result;
    }
    return { ...outcome, requeued };
  }

  async verifyMessage(
    userId: string,
    messageId: string,
    dto: CreateHumanVerificationDto,
  ) {
    const dataset = await this.dataset.prepare(userId);
    const [message, item, roleAssignment] = await Promise.all([
      this.prisma.aiEmailMessage.findFirst({
        where: { id: messageId, userId },
        select: { id: true, fromAddress: true, templateFingerprint: true },
      }),
      this.prisma.aiDatasetItem.findFirst({
        where: {
          datasetId: dataset.id,
          userId,
          sourceType: EMAIL_SOURCE_TYPE,
          sourceId: messageId,
        },
        select: { partition: true },
      }),
      this.prisma.userRole.findUnique({
        where: { userId },
        select: { role: true },
      }),
    ]);
    if (!message || !item) {
      throw new NotFoundException('Mensaje no encontrado');
    }
    assertHumanVerificationLabels(dto);

    const correctedPayload = humanVerificationPayload(dto);
    const notes = dto.notes?.trim() || null;
    const verification = await this.prisma.$transaction(async (tx) => {
      await lockReviewGroup(tx, {
        userId,
        groupKey: reviewGroupKey(
          message.fromAddress,
          message.templateFingerprint ?? null,
        ),
      });
      const latestVerification = await tx.aiHumanVerification.findFirst({
        where: {
          userId,
          targetType: REVIEW_TARGET_TYPE,
          targetId: messageId,
        },
        orderBy: { sequence: 'desc' },
        select: VERIFICATION_SELECT,
      });
      const existing = this.retryVerification({
        latestVerification,
        verdict: dto.verdict,
        correctedPayload,
        notes,
      });
      if (existing) {
        return existing;
      }
      return tx.aiHumanVerification.create({
        data: {
          userId,
          verifierRole: roleAssignment?.role ?? 'USER',
          targetType: REVIEW_TARGET_TYPE,
          targetId: messageId,
          verdict: dto.verdict,
          correctedPayload: correctedPayload as never,
          notes,
          isGroundTruth: item.partition === 'HOLDOUT',
        },
        select: VERIFICATION_SELECT,
      });
    });
    const requeued = await this.reclassifyAfterVerification(
      () =>
        this.reclassification.reclassifyAfterMessageVerification({
          userId,
          messageId,
          correctedLabel: verificationLabel({
            verdict: dto.verdict,
            correctedPayload: correctedPayload ?? null,
          }),
        }),
      `message ${messageId}`,
    );
    return {
      ...verification,
      sequence: verification.sequence.toString(),
      requeued,
    };
  }

  /**
   * Repetir la misma verificación no agrega evidencia: el reintento reutiliza
   * la última fila idéntica y solo vuelve a intentar la reclasificación.
   */
  private retryVerification<
    T extends {
      verdict: string;
      correctedPayload: unknown;
      notes: string | null;
    },
  >({
    latestVerification,
    verdict,
    correctedPayload,
    notes,
  }: {
    latestVerification: T | null;
    verdict: string;
    correctedPayload: Record<string, unknown> | undefined;
    notes: string | null;
  }): T | null {
    if (!latestVerification) {
      return null;
    }
    const sameVerification =
      latestVerification.verdict === verdict &&
      latestVerification.notes === notes &&
      isDeepStrictEqual(
        latestVerification.correctedPayload ?? null,
        correctedPayload ?? null,
      );
    return sameVerification ? latestVerification : null;
  }

  private async reclassifyAfterVerification(
    reclassify: () => Promise<ReclassificationResult>,
    context: string,
  ): Promise<number> {
    try {
      const { requeued } = await reclassify();
      return requeued;
    } catch (error) {
      // La verificación ya está guardada. El reintento es idempotente: reutiliza
      // la fila y vuelve a intentar la reclasificación.
      this.logger.warn(
        `Reclassification failed after ${context}: ${safeErrorCode(error)}`,
      );
      throw new Error(
        'La verificación quedó guardada, pero no se pudo reclasificar el historial. Reintenta la misma verificación.',
        { cause: error },
      );
    }
  }
}

async function lockReviewGroup(
  tx: Prisma.TransactionClient,
  { userId, groupKey }: { userId: string; groupKey: string },
): Promise<void> {
  // Serialize two batches of the same group: verifications are append-only,
  // so a duplicate written concurrently could not be removed later.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}), hashtext(${groupKey}))`;
}

function reviewGroupKey(
  fromAddress: string,
  templateFingerprint: string | null,
): string {
  return JSON.stringify([fromAddress, templateFingerprint]);
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code).slice(0, 80);
  }
  return 'RECLASSIFICATION_FAILED';
}
