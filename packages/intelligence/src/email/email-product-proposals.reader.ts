import { NotFoundException } from '@nestjs/common';
import {
  matchesProposalInstitution,
  type EmailProductProposalInstitutionCandidate,
  type EmailProductProposalProductLookup,
} from '@personal-os/contracts';
import type { PrismaService } from '@personal-os/database';
import type { EmailProductProposalCatalogRegistry } from './email-product-proposal-catalog.registry';
import { MAX_DISCOVERY_LIMIT } from './email-product-proposals.constants';
import { parseDraft } from './email-product-proposals.draft';
import type {
  ProposalRow,
  ProposalStatus,
  ProposalView,
} from './email-product-proposals.types';

type ProposalReadRow = {
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
};

type EmailProductProposalReaderDependencies = {
  prisma: PrismaService;
  catalogs: EmailProductProposalCatalogRegistry;
};

/** Lee las propuestas y arma la respuesta con sus coincidencias. */
export class EmailProductProposalReader {
  private readonly prisma: PrismaService;
  private readonly catalogs: EmailProductProposalCatalogRegistry;

  constructor({ prisma, catalogs }: EmailProductProposalReaderDependencies) {
    this.prisma = prisma;
    this.catalogs = catalogs;
  }

  async list(userId: string, status?: ProposalStatus): Promise<ProposalView[]> {
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
    const matches = await this.proposalMatches({ userId, rows });
    return rows.map((row) =>
      this.mapProposal(
        row,
        matches.institutions,
        matches.productIdsByProposal.get(row.id) ?? [],
      ),
    );
  }

  async get(userId: string, proposalId: string): Promise<ProposalView> {
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
    const matches = await this.proposalMatches({ userId, rows: [row] });
    return this.mapProposal(
      row,
      matches.institutions,
      matches.productIdsByProposal.get(row.id) ?? [],
    );
  }

  async findProposal(userId: string, proposalId: string): Promise<ProposalRow> {
    const proposal = await this.prisma.aiEmailProductProposal.findFirst({
      where: { id: proposalId, userId },
      select: {
        id: true,
        userId: true,
        status: true,
        productType: true,
        draft: true,
        approvedProductId: true,
      },
    });
    if (!proposal) {
      throw new NotFoundException('Propuesta no encontrada');
    }
    return proposal;
  }

  /**
   * Instituciones compatibles de todas las filas y productos activos que ya
   * existen para cada propuesta pendiente. Una sola consulta por tipo.
   */
  private async proposalMatches({
    userId,
    rows,
  }: {
    userId: string;
    rows: readonly { id: string; status: ProposalStatus; draft: unknown }[];
  }): Promise<{
    institutions: readonly EmailProductProposalInstitutionCandidate[];
    productIdsByProposal: Map<string, readonly string[]>;
  }> {
    const institutions = await this.catalogs.get().listInstitutions(userId);
    const pending = rows.filter((row) => row.status === 'PENDING');
    const lookups: EmailProductProposalProductLookup[] = pending.map((row) => {
      const draft = parseDraft(row.draft);
      return {
        productType: draft.productType,
        lastFour: draft.lastFour,
        institution: draft.institution,
      };
    });
    const productMatches = await this.catalogs
      .get()
      .findProductMatches(userId, lookups);
    return {
      institutions,
      productIdsByProposal: new Map(
        pending.map((row, index) => [row.id, productMatches[index] ?? []]),
      ),
    };
  }

  private mapProposal(
    row: ProposalReadRow,
    institutions: readonly EmailProductProposalInstitutionCandidate[],
    matchedProductIds: readonly string[],
  ): ProposalView {
    const draft = parseDraft(row.draft);
    const accountNumberProvided = Boolean(draft.accountNumberCiphertext);
    const {
      accountNumberCiphertext: _ciphertext,
      accountNumberHash: _hash,
      ...editableDraft
    } = draft;
    void _ciphertext;
    void _hash;
    const matchedInstitutionIds = institutions
      .filter((institution) =>
        matchesProposalInstitution(institution, draft.institution),
      )
      .map((institution) => institution.id);
    return {
      id: row.id,
      productType: row.productType,
      status: row.status,
      matchedProductId:
        matchedProductIds.length === 1 ? matchedProductIds[0] : null,
      matchedProductIds: [...matchedProductIds],
      draft: {
        ...editableDraft,
        accountNumberProvided,
        institution: {
          ...editableDraft.institution,
          matchedInstitutionId:
            matchedInstitutionIds.length === 1
              ? matchedInstitutionIds[0]
              : null,
          matchedInstitutionIds,
        },
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
