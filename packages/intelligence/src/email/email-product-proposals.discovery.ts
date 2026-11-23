import { BadRequestException } from '@nestjs/common';
import type {
  EmailProductProposalCatalogPort,
  EmailProductProposalDraft,
  SignalConsumer,
  SignalImportPreview,
} from '@personal-os/contracts';
import type { Prisma, PrismaService } from '@personal-os/database';
import type { AiSignalConsumerRegistry } from '../signals/ai-signal-consumer.registry';
import type { EmailProductProposalCatalogRegistry } from './email-product-proposal-catalog.registry';
import {
  detectBhdEmailProductProposal,
  type DetectedEmailProductProposal,
} from './email-product-proposal-detector';
import { MAX_DISCOVERY_LIMIT } from './email-product-proposals.constants';
import {
  isProductTargetReview,
  toRoutedSignal,
} from './email-product-proposals.signals';
import { readTransaction } from './email-product-proposals.transaction';
import type { ProposalDiscoverySummary } from './email-product-proposals.types';

type DiscoverySignalRow = Prisma.AiSignalGetPayload<{
  include: {
    emailMessage: {
      select: {
        id: true;
        fromDomain: true;
        subject: true;
        receivedAt: true;
        content: { select: { sanitizedBody: true } };
      };
    };
  };
}>;

type DiscoveryTally = Omit<
  ProposalDiscoverySummary,
  'scanned' | 'limit' | 'limitReached'
>;

type DiscoveryTallyKey = keyof DiscoveryTally;

type EmailProductProposalDiscoveryDependencies = {
  prisma: PrismaService;
  consumers: AiSignalConsumerRegistry;
  catalogs: EmailProductProposalCatalogRegistry;
};

/** Encuentra productos BHD en señales de revisión y guarda su propuesta. */
export class EmailProductProposalDiscovery {
  private readonly prisma: PrismaService;
  private readonly consumers: AiSignalConsumerRegistry;
  private readonly catalogs: EmailProductProposalCatalogRegistry;

  constructor({
    prisma,
    consumers,
    catalogs,
  }: EmailProductProposalDiscoveryDependencies) {
    this.prisma = prisma;
    this.consumers = consumers;
    this.catalogs = catalogs;
  }

  async run({
    userId,
    messageIds,
    limit,
  }: {
    userId: string;
    messageIds?: readonly string[];
    limit: number;
  }): Promise<ProposalDiscoverySummary> {
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
    const rows = await this.findSignals({ userId, ids, limit });
    const finance = this.consumers.get('FINANCE');
    const catalog = this.catalogs.get();
    const tally = emptyTally();
    for (const row of rows) {
      const rowTally = await this.proposeFromSignal({
        row,
        userId,
        finance,
        catalog,
      });
      addTally(tally, rowTally);
    }
    return {
      scanned: rows.length,
      limit,
      limitReached: rows.length === limit,
      ...tally,
    };
  }

  private findSignals({
    userId,
    ids,
    limit,
  }: {
    userId: string;
    ids?: readonly string[];
    limit: number;
  }): Promise<DiscoverySignalRow[]> {
    return this.prisma.aiSignal.findMany({
      where: {
        userId,
        domain: 'FINANCE',
        sourceType: 'EMAIL_MESSAGE',
        status: 'ROUTED',
        ...(ids ? { sourceId: { in: [...ids] } } : {}),
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
  }

  private async proposeFromSignal({
    row,
    userId,
    finance,
    catalog,
  }: {
    row: DiscoverySignalRow;
    userId: string;
    finance: SignalConsumer;
    catalog: EmailProductProposalCatalogPort;
  }): Promise<DiscoveryTally> {
    const tally = emptyTally();
    const message = row.emailMessage;
    const body = message.content?.sanitizedBody;
    if (!body) {
      tally.ignored = 1;
      return tally;
    }
    const preview = await finance.preview?.(toRoutedSignal(row));
    if (!isProductTargetPreview(preview)) {
      tally.ignored = 1;
      return tally;
    }
    const transaction = readTransaction(row.payload);
    const detections = detectBhdEmailProductProposal({
      fromDomain: message.fromDomain,
      subject: message.subject,
      body,
      movementClass: transaction?.movementClass ?? null,
      accountNumberLast4: transaction?.accountNumberLast4 ?? null,
    });
    if (!detections.length) {
      tally.ignored = 1;
      return tally;
    }
    for (const detection of detections) {
      const tallyKeys = await this.recordDetection({
        userId,
        messageId: message.id,
        detection,
        catalog,
      });
      for (const tallyKey of tallyKeys) {
        tally[tallyKey] += 1;
      }
    }
    return tally;
  }

  private async recordDetection({
    userId,
    messageId,
    detection,
    catalog,
  }: {
    userId: string;
    messageId: string;
    detection: DetectedEmailProductProposal;
    catalog: EmailProductProposalCatalogPort;
  }): Promise<DiscoveryTallyKey[]> {
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
    // Si ya hay propuesta para este producto, la evidencia se sigue sumando
    // aunque el producto exista; el listado la marca para vincularlo mientras
    // siga pendiente.
    if (!previousProposal) {
      const existing = await catalog.findExisting(userId, draft);
      if (existing) {
        return [existing.ambiguous ? 'ambiguous' : 'alreadyExists'];
      }
    }
    const proposal = await this.prisma.aiEmailProductProposal.upsert({
      where: { userId_deduplicationKey: { userId, deduplicationKey } },
      create: {
        userId,
        productType: detection.productType,
        deduplicationKey,
        draft,
      },
      update: {},
      select: { id: true },
    });
    const inserted =
      await this.prisma.aiEmailProductProposalEvidence.createMany({
        data: [
          {
            userId,
            proposalId: proposal.id,
            messageId,
            evidence: detection.evidence,
          },
        ],
        skipDuplicates: true,
      });
    if (inserted.count === 0) {
      return [];
    }
    return previousProposal ? ['evidenceAdded'] : ['created', 'evidenceAdded'];
  }
}

function isProductTargetPreview(
  preview: SignalImportPreview | undefined,
): boolean {
  if (!preview) {
    return false;
  }
  if (preview.outcome !== 'REVIEW_REQUIRED') {
    return false;
  }
  return isProductTargetReview(preview.reviewReasons ?? [preview.reason ?? '']);
}

function emptyTally(): DiscoveryTally {
  return {
    created: 0,
    evidenceAdded: 0,
    ignored: 0,
    alreadyExists: 0,
    ambiguous: 0,
  };
}

function addTally(target: DiscoveryTally, delta: DiscoveryTally): void {
  target.created += delta.created;
  target.evidenceAdded += delta.evidenceAdded;
  target.ignored += delta.ignored;
  target.alreadyExists += delta.alreadyExists;
  target.ambiguous += delta.ambiguous;
}
