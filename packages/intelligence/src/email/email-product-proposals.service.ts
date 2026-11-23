import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import { AiSignalConsumerRegistry } from '../signals/ai-signal-consumer.registry';
import { AiSignalsService } from '../signals/ai-signals.service';
import type { UpdateEmailProductProposalDto } from './dto/email-product-proposal.dto';
import { EmailProductProposalCatalogRegistry } from './email-product-proposal-catalog.registry';
import { EmailProductProposalApproval } from './email-product-proposals.approval';
import { MAX_DISCOVERY_LIMIT } from './email-product-proposals.constants';
import { EmailProductProposalDiscovery } from './email-product-proposals.discovery';
import { EmailProductProposalReader } from './email-product-proposals.reader';
import { EmailProductProposalSignals } from './email-product-proposals.signals';
import type {
  ProposalApprovalView,
  ProposalDiscoveryView,
  ProposalStatus,
  ProposalView,
} from './email-product-proposals.types';
import { EmailProductProposalUpdate } from './email-product-proposals.update';

@Injectable()
export class EmailProductProposalsService {
  private readonly reader: EmailProductProposalReader;
  private readonly discovery: EmailProductProposalDiscovery;
  private readonly editor: EmailProductProposalUpdate;
  private readonly approval: EmailProductProposalApproval;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumers: AiSignalConsumerRegistry,
    private readonly signals: AiSignalsService,
    private readonly catalogs: EmailProductProposalCatalogRegistry,
  ) {
    this.reader = new EmailProductProposalReader({
      prisma: this.prisma,
      catalogs: this.catalogs,
    });
    const proposalSignals = new EmailProductProposalSignals({
      prisma: this.prisma,
      consumers: this.consumers,
      signals: this.signals,
    });
    this.discovery = new EmailProductProposalDiscovery({
      prisma: this.prisma,
      consumers: this.consumers,
      catalogs: this.catalogs,
    });
    this.editor = new EmailProductProposalUpdate({
      prisma: this.prisma,
      reader: this.reader,
      catalogs: this.catalogs,
    });
    this.approval = new EmailProductProposalApproval({
      prisma: this.prisma,
      reader: this.reader,
      catalogs: this.catalogs,
      signals: proposalSignals,
    });
  }

  async discover({
    userId,
    messageIds,
    limit = MAX_DISCOVERY_LIMIT,
  }: {
    userId: string;
    messageIds?: readonly string[];
    limit?: number;
  }): Promise<ProposalDiscoveryView> {
    const summary = await this.discovery.run({ userId, messageIds, limit });
    return {
      ...summary,
      proposals: await this.reader.list(userId, 'PENDING'),
    };
  }

  async list(userId: string, status?: ProposalStatus): Promise<ProposalView[]> {
    return this.reader.list(userId, status);
  }

  async update(
    userId: string,
    proposalId: string,
    patch: UpdateEmailProductProposalDto,
  ): Promise<ProposalView> {
    return this.editor.apply(userId, proposalId, patch);
  }

  async approve({
    userId,
    proposalId,
    productId,
  }: {
    userId: string;
    proposalId: string;
    productId?: string;
  }): Promise<ProposalApprovalView> {
    return this.approval.approve({ userId, proposalId, productId });
  }

  async discard(userId: string, proposalId: string): Promise<ProposalView> {
    return this.editor.discard(userId, proposalId);
  }

  async get(userId: string, proposalId: string): Promise<ProposalView> {
    return this.reader.get(userId, proposalId);
  }
}
