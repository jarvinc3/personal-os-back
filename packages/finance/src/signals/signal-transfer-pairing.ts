import { Injectable } from '@nestjs/common';
import { PrismaService, type Prisma } from '@personal-os/database';
import { ResolveUserBaseCurrencyUseCase } from '../fx/application/resolve-user-base-currency';
import { ImportFinancialTransactionUseCase } from '../ledger/application/import-financial-transaction.use-case';
import {
  isUnpairedTransferCandidate,
  movementClassOf,
  pickTransferMatch,
  REFERENCE_MATCH_WINDOW_MS,
  type ImportTransferCandidate,
} from '../ledger/application/match-imported-transfers';
import { isTransferMovementClass } from '../ledger/domain/movement-class';

const pairingInstrumentInclude = {
  account: { select: { institutionId: true, type: true } },
  card: { select: { institutionId: true } },
} satisfies Prisma.FinTransactionInclude;

type PairingTransactionRow = Prisma.FinTransactionGetPayload<{
  include: typeof pairingInstrumentInclude;
}>;

function toTransferPairingCandidate(
  row: PairingTransactionRow,
  baseCurrency: string,
): ImportTransferCandidate {
  return {
    id: row.id,
    type: row.type,
    accountId: row.accountId,
    externalReference: row.externalReference,
    amount: row.amountBaseCurrency,
    currency: baseCurrency,
    transactionDate: row.transactionDate,
    transferGroupId: row.transferGroupId,
    categoryId: row.categoryId,
    description: row.description,
    merchant: row.merchant,
    notes: row.notes,
    aiMetadata: row.aiMetadata,
    account: row.account,
    card: row.card,
  };
}

/**
 * La pata importada queda pendiente. Solo se empareja cuando hay un candidato
 * único; con varios, la pata sigue pendiente y el motivo queda en la evidencia.
 */
@Injectable()
export class TransferPairing {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importTransaction: ImportFinancialTransactionUseCase,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
  ) {}

  async pair(userId: string, transactionId: string): Promise<void> {
    const current = await this.prisma.finTransaction.findFirst({
      where: { id: transactionId, userId },
      include: pairingInstrumentInclude,
    });
    if (
      !current ||
      !current.transferGroupId ||
      !isTransferMovementClass(movementClassOf(current))
    ) {
      return;
    }
    const baseCurrency = await this.baseCurrency.execute(userId);
    const since = new Date(
      current.transactionDate.getTime() - REFERENCE_MATCH_WINDOW_MS,
    );
    const rows = await this.prisma.finTransaction.findMany({
      where: {
        userId,
        source: 'EMAIL',
        type: { in: ['DEBIT', 'CREDIT'] },
        status: { in: ['PENDING', 'CONFIRMED'] },
        transferGroupId: { not: null },
        transactionDate: { gte: since },
      },
      include: pairingInstrumentInclude,
      orderBy: { transactionDate: 'desc' },
      take: 100,
    });
    const groupIds = [
      ...new Set(
        rows
          .map((row) => row.transferGroupId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const groupRows =
      groupIds.length === 0
        ? []
        : await this.prisma.finTransaction.findMany({
            where: { userId, transferGroupId: { in: groupIds } },
            include: pairingInstrumentInclude,
          });
    const rowsById = new Map(rows.map((row) => [row.id, row] as const));
    for (const row of groupRows) {
      rowsById.set(row.id, row);
    }
    const allRows = [...rowsById.values()];
    const allCandidates = allRows.map((row) =>
      toTransferPairingCandidate(row, baseCurrency),
    );
    const candidates = allRows
      .filter((row) => row.source === 'EMAIL')
      .map((row) => toTransferPairingCandidate(row, baseCurrency));
    const unpaired = candidates.filter((row) =>
      isUnpairedTransferCandidate(row, allCandidates),
    );
    const currentCandidate = candidates.find((row) => row.id === transactionId);
    if (
      !currentCandidate ||
      !isUnpairedTransferCandidate(currentCandidate, allCandidates)
    ) {
      return;
    }
    const { match, candidateIds } = pickTransferMatch(
      currentCandidate,
      unpaired,
    );
    if (match) {
      const debitId =
        currentCandidate.type === 'DEBIT' ? currentCandidate.id : match.id;
      const creditId =
        currentCandidate.type === 'CREDIT' ? currentCandidate.id : match.id;
      await this.importTransaction.pairTransferLegs(userId, debitId, creditId);
      return;
    }
    if (candidateIds.length > 1) {
      await this.recordEvidence({
        transactionId,
        currentMetadata: current.aiMetadata,
        candidateIds,
      });
    }
  }

  private async recordEvidence({
    transactionId,
    currentMetadata,
    candidateIds,
  }: {
    transactionId: string;
    currentMetadata: unknown;
    candidateIds: string[];
  }): Promise<void> {
    const metadata =
      currentMetadata &&
      typeof currentMetadata === 'object' &&
      !Array.isArray(currentMetadata)
        ? (currentMetadata as Record<string, unknown>)
        : {};
    await this.prisma.finTransaction.update({
      where: { id: transactionId },
      data: {
        aiMetadata: {
          ...metadata,
          transferPairing: {
            reason: 'TRANSFER_PAIR_AMBIGUOUS',
            candidateTransactionIds: candidateIds,
          },
        },
      },
    });
  }
}
