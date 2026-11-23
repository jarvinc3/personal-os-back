import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type {
  EmailProductProposalDraft,
  EmailProductProposalLinkableProduct,
} from '@personal-os/contracts';
import type { PrismaService } from '@personal-os/database';
import type { EmailProductProposalCatalogRegistry } from './email-product-proposal-catalog.registry';
import { parseDraft, withFinalLastFour } from './email-product-proposals.draft';
import type { EmailProductProposalReader } from './email-product-proposals.reader';
import type { EmailProductProposalSignals } from './email-product-proposals.signals';
import type {
  ProposalApprovalView,
  ProposalRow,
} from './email-product-proposals.types';

type EmailProductProposalApprovalDependencies = {
  prisma: PrismaService;
  reader: EmailProductProposalReader;
  catalogs: EmailProductProposalCatalogRegistry;
  signals: EmailProductProposalSignals;
};

/** Aprobación de una propuesta: vincula un producto o lo crea del borrador. */
export class EmailProductProposalApproval {
  private readonly prisma: PrismaService;
  private readonly reader: EmailProductProposalReader;
  private readonly catalogs: EmailProductProposalCatalogRegistry;
  private readonly signals: EmailProductProposalSignals;

  constructor({
    prisma,
    reader,
    catalogs,
    signals,
  }: EmailProductProposalApprovalDependencies) {
    this.prisma = prisma;
    this.reader = reader;
    this.catalogs = catalogs;
    this.signals = signals;
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
    const proposal = await this.reader.findProposal(userId, proposalId);
    if (productId) {
      return this.linkExistingProduct({ userId, proposal, productId });
    }
    return this.approveFromDraft({ userId, proposal });
  }

  /** Vincula el producto que el usuario creó con el formulario nativo. */
  private async linkExistingProduct({
    userId,
    proposal,
    productId,
  }: {
    userId: string;
    proposal: ProposalRow;
    productId: string;
  }): Promise<ProposalApprovalView> {
    if (proposal.status === 'APPROVED') {
      if (proposal.approvedProductId === productId) {
        return this.reader.get(userId, proposal.id);
      }
      throw new ConflictException(
        'La propuesta ya está aprobada con otro producto',
      );
    }
    if (proposal.status !== 'PENDING') {
      throw new ConflictException(
        'La propuesta no está pendiente de aprobación',
      );
    }
    const draft = parseDraft(proposal.draft);
    const product = await this.assertLinkableProduct({
      userId,
      productId,
      draft,
    });
    await this.lockForApproval({ userId, proposalId: proposal.id });
    try {
      const reevaluatedSignals = await this.signals.reevaluateEvidence(
        userId,
        proposal.id,
      );
      await this.markApproved({
        userId,
        proposalId: proposal.id,
        productId,
        draft: withFinalLastFour(draft, product.lastFour),
      });
      return {
        ...(await this.reader.get(userId, proposal.id)),
        approval: { duplicate: false, productId, reevaluatedSignals },
      };
    } catch (error) {
      await this.releaseToPending({ userId, proposalId: proposal.id });
      throw error;
    }
  }

  /** Comportamiento anterior: crea o reutiliza el producto desde el borrador. */
  private async approveFromDraft({
    userId,
    proposal,
  }: {
    userId: string;
    proposal: ProposalRow;
  }): Promise<ProposalApprovalView> {
    if (proposal.status === 'APPROVED') {
      return this.reader.get(userId, proposal.id);
    }
    await this.lockForApproval({ userId, proposalId: proposal.id });
    try {
      const draft = parseDraft(proposal.draft);
      const createdProduct = await this.catalogs
        .get()
        .createOrReuse(userId, draft);
      const reevaluatedSignals = await this.signals.reevaluateEvidence(
        userId,
        proposal.id,
      );
      await this.markApproved({
        userId,
        proposalId: proposal.id,
        productId: createdProduct.productId,
      });
      return {
        ...(await this.reader.get(userId, proposal.id)),
        approval: {
          duplicate: createdProduct.duplicate,
          productId: createdProduct.productId,
          reevaluatedSignals,
        },
      };
    } catch (error) {
      await this.releaseToPending({ userId, proposalId: proposal.id });
      throw error;
    }
  }

  private async assertLinkableProduct({
    userId,
    productId,
    draft,
  }: {
    userId: string;
    productId: string;
    draft: EmailProductProposalDraft;
  }): Promise<EmailProductProposalLinkableProduct & { lastFour: string }> {
    const product = await this.catalogs
      .get()
      .findProductForLink(userId, productId);
    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }
    if (!product.isActive) {
      throw new ConflictException(
        'El producto está archivado; desarchívalo o elige otro',
      );
    }
    if (!product.lastFour) {
      throw new BadRequestException(
        'El producto no tiene últimos 4 dígitos; no se puede verificar la propuesta',
      );
    }
    if (product.productType !== draft.productType) {
      const proposalKind =
        draft.productType === 'ACCOUNT' ? 'cuenta' : 'tarjeta';
      const productKind =
        product.productType === 'ACCOUNT' ? 'cuenta' : 'tarjeta';
      throw new BadRequestException(
        `La propuesta es de ${proposalKind} y el producto es de ${productKind}`,
      );
    }
    if (product.institutionId === null || product.institutionIsSystem) {
      throw new BadRequestException(
        'Vincula un producto de una institución, no de Efectivo',
      );
    }
    return { ...product, lastFour: product.lastFour };
  }

  private async lockForApproval({
    userId,
    proposalId,
  }: {
    userId: string;
    proposalId: string;
  }): Promise<void> {
    const locked = await this.prisma.aiEmailProductProposal.updateMany({
      where: { id: proposalId, userId, status: 'PENDING' },
      data: { status: 'APPROVING' },
    });
    if (locked.count !== 1) {
      throw new ConflictException(
        'La propuesta no está pendiente de aprobación',
      );
    }
  }

  private async markApproved({
    userId,
    proposalId,
    productId,
    draft,
  }: {
    userId: string;
    proposalId: string;
    productId: string;
    draft?: EmailProductProposalDraft;
  }): Promise<void> {
    await this.prisma.aiEmailProductProposal.updateMany({
      where: { id: proposalId, userId, status: 'APPROVING' },
      data: {
        status: 'APPROVED',
        approvedProductId: productId,
        ...(draft ? { draft } : {}),
      },
    });
  }

  private async releaseToPending({
    userId,
    proposalId,
  }: {
    userId: string;
    proposalId: string;
  }): Promise<void> {
    await this.prisma.aiEmailProductProposal.updateMany({
      where: { id: proposalId, userId, status: 'APPROVING' },
      data: { status: 'PENDING' },
    });
  }
}
