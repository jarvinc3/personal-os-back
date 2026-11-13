import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  EmailProductProposalDraft,
  JsonObject,
  RoutedSignal,
} from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';
import { AiSignalConsumerRegistry } from '../signals/ai-signal-consumer.registry';
import { AiSignalsService } from '../signals/ai-signals.service';
import { EmailProductProposalCatalogRegistry } from './email-product-proposal-catalog.registry';
import { detectBhdEmailProductProposal } from './email-product-proposal-detector';
import type { UpdateEmailProductProposalDto } from './dto/email-product-proposal.dto';

const TARGET_REASONS = [
  'NO_LEDGER_TARGET',
  'AMBIGUOUS_LEDGER_TARGET',
  'TRANSFER_ACCOUNT_',
  'CARD_PAYMENT_',
];
const MAX_DISCOVERY_LIMIT = 200;

type ProposalStatus = 'PENDING' | 'APPROVING' | 'APPROVED' | 'DISCARDED';

@Injectable()
export class EmailProductProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consumers: AiSignalConsumerRegistry,
    private readonly signals: AiSignalsService,
    private readonly catalogs: EmailProductProposalCatalogRegistry,
  ) {}

  async discover({
    userId,
    messageIds,
    limit = MAX_DISCOVERY_LIMIT,
  }: {
    userId: string;
    messageIds?: readonly string[];
    limit?: number;
  }) {
    if (limit < 1 || limit > MAX_DISCOVERY_LIMIT) {
      throw new BadRequestException(
        `limit debe estar entre 1 y ${MAX_DISCOVERY_LIMIT}`,
      );
    }
    const ids = messageIds ? [...new Set(messageIds)] : undefined;
    if (ids && (!ids.length || ids.length > MAX_DISCOVERY_LIMIT)) {
      throw new BadRequestException(
        `messageIds debe contener entre 1 y ${MAX_DISCOVERY_LIMIT} ids únicos`,
      );
    }
    const rows = await this.prisma.aiSignal.findMany({
      where: {
        userId,
        domain: 'FINANCE',
        sourceType: 'EMAIL_MESSAGE',
        status: 'ROUTED',
        ...(ids ? { sourceId: { in: ids } } : {}),
        emailMessage: {
          fromDomain: { equals: 'bhd.com.do', mode: 'insensitive' },
          content: { isNot: null },
        },
      },
      include: {
        emailMessage: {
          select: {
            id: true,
            fromDomain: true,
            subject: true,
            receivedAt: true,
            content: { select: { sanitizedBody: true } },
          },
        },
      },
      orderBy: [{ detectedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    const finance = this.consumers.get('FINANCE');
    const catalog = this.catalogs.get();
    let created = 0;
    let evidenceAdded = 0;
    let ignored = 0;

    for (const row of rows) {
      const message = row.emailMessage;
      const body = message.content?.sanitizedBody;
      if (!body) {
        ignored += 1;
        continue;
      }
      const signal = toRoutedSignal(row);
      const preview = await finance.preview?.(signal);
      if (
        !preview ||
        preview.outcome !== 'REVIEW_REQUIRED' ||
        !isProductTargetReview(preview.reviewReasons ?? [preview.reason ?? ''])
      ) {
        ignored += 1;
        continue;
      }
      const transaction = readTransaction(row.payload);
      const detections = detectBhdEmailProductProposal({
        fromDomain: message.fromDomain,
        subject: message.subject,
        body,
        movementClass: transaction?.movementClass ?? null,
      });
      if (!detections.length) {
        ignored += 1;
        continue;
      }

      for (const detection of detections) {
        const draft: EmailProductProposalDraft = {
          productType: detection.productType,
          name: detection.name,
          lastFour: detection.lastFour,
          currency: detection.currency,
          accountType: detection.accountType,
          cardType: detection.cardType,
          network: detection.network,
          accountId: null,
          institution: detection.institution,
          accountNumberCiphertext: null,
          accountNumberHash: null,
        };
        const existing = await catalog.findExisting(userId, draft);
        if (existing) {
          ignored += 1;
          continue;
        }
        const deduplicationKey = [
          detection.institution.domain,
          detection.productType,
          detection.lastFour,
        ].join(':');
        const previousProposal =
          await this.prisma.aiEmailProductProposal.findUnique({
            where: { userId_deduplicationKey: { userId, deduplicationKey } },
            select: { id: true },
          });
        const proposal = await this.prisma.aiEmailProductProposal.upsert({
          where: { userId_deduplicationKey: { userId, deduplicationKey } },
          create: {
            userId,
            productType: detection.productType,
            deduplicationKey,
            draft: draft,
          },
          update: {},
          select: { id: true },
        });
        const evidence = detection.evidence;
        const inserted =
          await this.prisma.aiEmailProductProposalEvidence.createMany({
            data: [
              {
                userId,
                proposalId: proposal.id,
                messageId: message.id,
                evidence: evidence,
              },
            ],
            skipDuplicates: true,
          });
        if (inserted.count > 0) {
          evidenceAdded += 1;
        }
        if (!previousProposal && inserted.count > 0) {
          created += 1;
        }
      }
    }

    return {
      scanned: rows.length,
      limit,
      limitReached: rows.length === limit,
      created,
      evidenceAdded,
      ignored,
      proposals: await this.list(userId, 'PENDING'),
    };
  }

  async list(userId: string, status?: ProposalStatus) {
    const rows = await this.prisma.aiEmailProductProposal.findMany({
      where: { userId, ...(status ? { status } : {}) },
      include: {
        evidence: {
          orderBy: { createdAt: 'asc' },
          include: {
            message: {
              select: {
                id: true,
                fromDomain: true,
                subject: true,
                receivedAt: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_DISCOVERY_LIMIT,
    });
    return rows.map((row) => this.mapProposal(row));
  }

  async update(
    userId: string,
    proposalId: string,
    patch: UpdateEmailProductProposalDto,
  ) {
    const proposal = await this.findProposal(userId, proposalId);
    if (proposal.status !== 'PENDING') {
      throw new ConflictException(
        'Solo se pueden editar propuestas pendientes',
      );
    }
    const draft = parseDraft(proposal.draft);
    if (
      draft.productType === 'ACCOUNT' &&
      (patch.cardType || patch.network || patch.accountId)
    ) {
      throw new BadRequestException(
        'Los campos de tarjeta no aplican a esta propuesta',
      );
    }
    if (
      draft.productType === 'CARD' &&
      (patch.accountType || patch.accountNumber !== undefined)
    ) {
      throw new BadRequestException(
        'Los campos de cuenta no aplican a esta propuesta',
      );
    }
    if (draft.productType === 'CARD' && patch.currency !== undefined) {
      throw new BadRequestException(
        'La moneda se configura en el balance de la tarjeta',
      );
    }
    if (
      patch.lastFour !== undefined &&
      patch.lastFour !== draft.lastFour &&
      draft.accountNumberCiphertext &&
      patch.accountNumber === undefined
    ) {
      throw new BadRequestException(
        'Envía el número completo junto con los últimos 4 al cambiarlos',
      );
    }

    const next: EmailProductProposalDraft = {
      ...draft,
      name: patch.name ?? draft.name,
      lastFour: patch.lastFour ?? draft.lastFour,
      currency:
        draft.productType === 'ACCOUNT'
          ? (patch.currency ?? draft.currency)
          : draft.currency,
      accountType: patch.accountType ?? draft.accountType,
      cardType: patch.cardType ?? draft.cardType,
      network: patch.network ?? draft.network,
      accountId:
        patch.accountId === undefined ? draft.accountId : patch.accountId,
      institution: {
        name: patch.institutionName ?? draft.institution.name,
        type: patch.institutionType ?? draft.institution.type,
        domain:
          patch.institutionDomain === undefined
            ? draft.institution.domain
            : patch.institutionDomain,
        country: patch.institutionCountry ?? draft.institution.country,
      },
    };

    if (draft.productType === 'ACCOUNT') {
      const changedLastFour =
        patch.lastFour !== undefined && patch.lastFour !== draft.lastFour;
      if (patch.accountNumber !== undefined || changedLastFour) {
        const number = await this.catalogs.get().prepareAccountNumber({
          accountNumber:
            patch.accountNumber !== undefined ? patch.accountNumber : undefined,
          ...(patch.lastFour !== undefined
            ? { lastFour: patch.lastFour }
            : patch.accountNumber === null
              ? { lastFour: draft.lastFour }
              : {}),
        });
        next.lastFour = number.lastFour;
        next.accountNumberCiphertext = number.ciphertext;
        next.accountNumberHash = number.hash;
      }
    }

    const updated = await this.prisma.aiEmailProductProposal.updateMany({
      where: { id: proposalId, userId, status: 'PENDING' },
      data: { draft: next },
    });
    if (updated.count !== 1) {
      throw new ConflictException('La propuesta cambió durante la edición');
    }
    return this.get(userId, proposalId);
  }

  async approve(userId: string, proposalId: string) {
    const proposal = await this.findProposal(userId, proposalId);
    if (proposal.status === 'APPROVED') {
      return this.get(userId, proposalId);
    }
    const locked = await this.prisma.aiEmailProductProposal.updateMany({
      where: { id: proposalId, userId, status: 'PENDING' },
      data: { status: 'APPROVING' },
    });
    if (locked.count !== 1) {
      throw new ConflictException(
        'La propuesta no está pendiente de aprobación',
      );
    }

    try {
      const draft = parseDraft(proposal.draft);
      const result = await this.catalogs.get().createOrReuse(userId, draft);
      const evidence =
        await this.prisma.aiEmailProductProposalEvidence.findMany({
          where: { userId, proposalId },
          select: { messageId: true },
        });
      const reevaluatedSignals = await this.reevaluateSignals(
        userId,
        evidence.map((item) => item.messageId),
      );
      await this.prisma.aiEmailProductProposal.updateMany({
        where: { id: proposalId, userId, status: 'APPROVING' },
        data: {
          status: 'APPROVED',
          approvedProductId: result.productId,
        },
      });
      return {
        ...(await this.get(userId, proposalId)),
        approval: {
          duplicate: result.duplicate,
          productId: result.productId,
          reevaluatedSignals,
        },
      };
    } catch (error) {
      await this.prisma.aiEmailProductProposal.updateMany({
        where: { id: proposalId, userId, status: 'APPROVING' },
        data: { status: 'PENDING' },
      });
      throw error;
    }
  }

  async discard(userId: string, proposalId: string) {
    const changed = await this.prisma.aiEmailProductProposal.updateMany({
      where: { id: proposalId, userId, status: 'PENDING' },
      data: { status: 'DISCARDED' },
    });
    if (changed.count !== 1) {
      throw new ConflictException('La propuesta no está pendiente');
    }
    return this.get(userId, proposalId);
  }

  async get(userId: string, proposalId: string) {
    const row = await this.prisma.aiEmailProductProposal.findFirst({
      where: { id: proposalId, userId },
      include: {
        evidence: {
          orderBy: { createdAt: 'asc' },
          include: {
            message: {
              select: {
                id: true,
                fromDomain: true,
                subject: true,
                receivedAt: true,
              },
            },
          },
        },
      },
    });
    if (!row) {
      throw new NotFoundException('Propuesta no encontrada');
    }
    return this.mapProposal(row);
  }

  private async findProposal(userId: string, proposalId: string) {
    const proposal = await this.prisma.aiEmailProductProposal.findFirst({
      where: { id: proposalId, userId },
      select: {
        id: true,
        userId: true,
        status: true,
        productType: true,
        draft: true,
      },
    });
    if (!proposal) {
      throw new NotFoundException('Propuesta no encontrada');
    }
    return proposal;
  }

  private async reevaluateSignals(userId: string, messageIds: string[]) {
    if (!messageIds.length) {
      return 0;
    }
    const rows = await this.prisma.aiSignal.findMany({
      where: {
        userId,
        domain: 'FINANCE',
        sourceType: 'EMAIL_MESSAGE',
        sourceId: { in: messageIds },
        status: 'ROUTED',
      },
      orderBy: [{ detectedAt: 'asc' }, { id: 'asc' }],
    });
    const consumer = this.consumers.get('FINANCE');
    let reevaluated = 0;
    for (const row of rows) {
      const signal = toRoutedSignal(row);
      const preview = await consumer.preview?.(signal);
      if (
        preview?.outcome === 'REVIEW_REQUIRED' &&
        isProductTargetReview(preview.reviewReasons ?? [preview.reason ?? ''])
      ) {
        continue;
      }
      const result = await consumer.consume(signal);
      await this.signals.recordConsumerOutcome(userId, row.id, result);
      reevaluated += 1;
    }
    return reevaluated;
  }

  private mapProposal(row: {
    id: string;
    productType: 'ACCOUNT' | 'CARD';
    status: ProposalStatus;
    draft: unknown;
    approvedProductId: string | null;
    createdAt: Date;
    evidence: Array<{
      messageId: string;
      evidence: unknown;
      createdAt: Date;
      message: {
        id: string;
        fromDomain: string;
        subject: string;
        receivedAt: Date;
      };
    }>;
  }) {
    const draft = parseDraft(row.draft);
    const accountNumberProvided = Boolean(draft.accountNumberCiphertext);
    const {
      accountNumberCiphertext: _ciphertext,
      accountNumberHash: _hash,
      ...editableDraft
    } = draft;
    void _ciphertext;
    void _hash;
    return {
      id: row.id,
      productType: row.productType,
      status: row.status,
      draft: {
        ...editableDraft,
        accountNumberProvided,
      },
      approvedProductId: row.approvedProductId,
      createdAt: row.createdAt.toISOString(),
      evidence: row.evidence.map((item) => ({
        messageId: item.message.id,
        fromDomain: item.message.fromDomain,
        subject: item.message.subject,
        receivedAt: item.message.receivedAt.toISOString(),
        match: item.evidence,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }
}

function parseDraft(value: unknown): EmailProductProposalDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('El borrador de propuesta no es válido');
  }
  const draft = value as EmailProductProposalDraft;
  if (
    (draft.productType !== 'ACCOUNT' && draft.productType !== 'CARD') ||
    typeof draft.lastFour !== 'string' ||
    !/^\d{4}$/.test(draft.lastFour)
  ) {
    throw new BadRequestException('El borrador de propuesta no es válido');
  }
  return draft;
}

function readTransaction(
  payload: unknown,
): { movementClass: string | null } | null {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const transaction = (payload as Record<string, unknown>).transaction;
  if (typeof transaction !== 'object' || transaction === null) {
    return null;
  }
  const movementClass = (transaction as Record<string, unknown>).movementClass;
  return {
    movementClass: typeof movementClass === 'string' ? movementClass : null,
  };
}

function isProductTargetReview(reasons: readonly string[]): boolean {
  return reasons.some((reason) =>
    TARGET_REASONS.some((prefix) => reason.startsWith(prefix)),
  );
}

function toRoutedSignal(row: {
  id: string;
  userId: string;
  type: string;
  sourceType: string;
  sourceId: string;
  payload: unknown;
  occurredAt: Date;
}): RoutedSignal {
  return {
    signalId: row.id,
    userId: row.userId,
    signalType: row.type,
    schemaVersion: 1,
    occurredAt: row.occurredAt.toISOString(),
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    payload: row.payload as JsonObject,
  };
}
