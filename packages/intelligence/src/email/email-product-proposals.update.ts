import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '@personal-os/database';
import type { UpdateEmailProductProposalDto } from './dto/email-product-proposal.dto';
import type { EmailProductProposalCatalogRegistry } from './email-product-proposal-catalog.registry';
import {
  assertPatchAllowed,
  buildUpdatedDraft,
  lastFourHintForNumber,
  parseDraft,
} from './email-product-proposals.draft';
import type { EmailProductProposalReader } from './email-product-proposals.reader';
import type { ProposalView } from './email-product-proposals.types';

type EmailProductProposalUpdateDependencies = {
  prisma: PrismaService;
  reader: EmailProductProposalReader;
  catalogs: EmailProductProposalCatalogRegistry;
};

/** Cambia el borrador de una propuesta pendiente o la descarta. */
export class EmailProductProposalUpdate {
  private readonly prisma: PrismaService;
  private readonly reader: EmailProductProposalReader;
  private readonly catalogs: EmailProductProposalCatalogRegistry;

  constructor({
    prisma,
    reader,
    catalogs,
  }: EmailProductProposalUpdateDependencies) {
    this.prisma = prisma;
    this.reader = reader;
    this.catalogs = catalogs;
  }

  async apply(
    userId: string,
    proposalId: string,
    patch: UpdateEmailProductProposalDto,
  ): Promise<ProposalView> {
    const proposal = await this.reader.findProposal(userId, proposalId);
    if (proposal.status !== 'PENDING') {
      throw new ConflictException(
        'Solo se pueden editar propuestas pendientes',
      );
    }
    const draft = parseDraft(proposal.draft);
    assertPatchAllowed({ draft, patch });
    let next = buildUpdatedDraft({ draft, patch });
    if (draft.productType === 'ACCOUNT') {
      const changedLastFour =
        patch.lastFour !== undefined && patch.lastFour !== draft.lastFour;
      if (patch.accountNumber !== undefined || changedLastFour) {
        const accountNumber = await this.catalogs.get().prepareAccountNumber({
          accountNumber:
            patch.accountNumber !== undefined ? patch.accountNumber : undefined,
          ...lastFourHintForNumber({ draft, patch }),
        });
        next = {
          ...next,
          lastFour: accountNumber.lastFour,
          accountNumberCiphertext: accountNumber.ciphertext,
          accountNumberHash: accountNumber.hash,
        };
      }
    }
    const updated = await this.prisma.aiEmailProductProposal.updateMany({
      where: { id: proposalId, userId, status: 'PENDING' },
      data: { draft: next },
    });
    if (updated.count !== 1) {
      throw new ConflictException('La propuesta cambió durante la edición');
    }
    return this.reader.get(userId, proposalId);
  }

  async discard(userId: string, proposalId: string): Promise<ProposalView> {
    const changed = await this.prisma.aiEmailProductProposal.updateMany({
      where: { id: proposalId, userId, status: 'PENDING' },
      data: { status: 'DISCARDED' },
    });
    if (changed.count !== 1) {
      throw new ConflictException('La propuesta no está pendiente');
    }
    return this.reader.get(userId, proposalId);
  }
}
