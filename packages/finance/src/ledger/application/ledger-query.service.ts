import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { clampPageLimit, toCursorPage } from '@personal-os/core';
import { LogoService } from '@personal-os/logos';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import type {
  FinTxStatus,
  ListTransactionsQuery,
} from './commands/ledger.commands';
import {
  mapLedgerTransaction,
  mapLogicalTransaction,
  mapOperation,
} from './ledger-mappers';
import type {
  LedgerRepositoryPort,
  LedgerTransactionRow,
} from './ports/ledger.repository.port';

/**
 * Read-only ledger queries for HTTP and façade consumers.
 */
@Injectable()
export class LedgerQueryService {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly logos: LogoService,
  ) {}

  async listTransactions(userId: string, query: ListTransactionsQuery) {
    const rows = await this.repo.findTransactions(userId, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.transactionDate.toISOString(),
    );
    if (!query.groupOperations) {
      return {
        ...page,
        items: page.items.map((item) =>
          mapLogicalTransaction(item, undefined, this.logos),
        ),
      };
    }
    return {
      ...page,
      items: await this.mapPageWithOperations(userId, page.items),
    };
  }

  private async mapPageWithOperations(
    userId: string,
    items: LedgerTransactionRow[],
  ) {
    const transferGroupIds = [
      ...new Set(
        items
          .map((item) => item.transferGroupId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const legs = await this.repo.findTransactionsByTransferGroupIds(
      userId,
      transferGroupIds,
    );
    const legsByGroup = new Map<string, LedgerTransactionRow[]>();
    for (const leg of legs) {
      if (!leg.transferGroupId) {
        continue;
      }
      const groupLegs = legsByGroup.get(leg.transferGroupId) ?? [];
      groupLegs.push(leg);
      legsByGroup.set(leg.transferGroupId, groupLegs);
    }
    return items.map((item) =>
      item.transferGroupId
        ? mapOperation(
            legsByGroup.get(item.transferGroupId) ?? [item],
            this.logos,
          )
        : mapLedgerTransaction(item, this.logos),
    );
  }

  async getTransaction(userId: string, id: string) {
    const tx = await this.repo.findTransactionById(id, userId);
    if (!tx) {
      throw new NotFoundException('Transacción no encontrada');
    }
    if (!tx.transferGroupId) {
      return mapLogicalTransaction(tx, undefined, this.logos);
    }
    const legs = await this.repo.findTransactionsByTransferGroupId(
      tx.transferGroupId,
      userId,
    );
    const counterpart = legs.find((leg) => leg.id !== tx.id) ?? null;
    return mapLogicalTransaction(tx, counterpart, this.logos);
  }

  /**
   * Movements with the same shape as `getTransaction`, in batch and without
   * throwing: a missing or foreign id is simply absent from the map.
   */
  async lookupTransactions(userId: string, ids: readonly string[]) {
    const rows = await this.repo.findTransactionsByIds(userId, ids);
    const transferGroupIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.transferGroupId ? [row.transferGroupId] : [],
        ),
      ),
    ];
    const legs = await this.repo.findTransactionsByTransferGroupIds(
      userId,
      transferGroupIds,
    );
    return new Map(
      rows.map((row) => [
        row.id,
        mapLogicalTransaction(
          row,
          row.transferGroupId
            ? (legs.find(
                (leg) =>
                  leg.transferGroupId === row.transferGroupId &&
                  leg.id !== row.id,
              ) ?? null)
            : undefined,
          this.logos,
        ),
      ]),
    );
  }

  findTransactionByImportReference(importReference: string, userId: string) {
    return this.repo.findTransactionByImportReference(importReference, userId);
  }

  findTransactionByExternalReference(userId: string, reference: string) {
    return this.repo.findTransactionByExternalReference(userId, reference);
  }

  findTransactionsByExternalReference(userId: string, reference: string) {
    return this.repo.findTransactionsByExternalReference(userId, reference);
  }

  findReverseCandidates(
    userId: string,
    params: {
      amount: number;
      currency: string;
      merchant: string | null;
      aroundDate: Date;
      statuses?: FinTxStatus[];
    },
  ) {
    return this.repo.findCandidatesForReverse(userId, params);
  }

  findImportedTransactionByEmailMessageId(userId: string, messageId: string) {
    return this.repo.findImportedTransactionByEmailMessageId(userId, messageId);
  }

  findLinkedRefundTotal(params: {
    userId: string;
    originalId: string;
    currency: string;
  }) {
    return this.repo.findLinkedRefundTotal(params);
  }

  findDedupeCandidate(
    userId: string,
    params: {
      externalReference: string | null;
      accountId?: string | null;
      cardId?: string | null;
      amount: number;
      currency: string;
      type: 'DEBIT' | 'CREDIT';
      merchant: string | null;
      transactionDate: Date;
    },
  ) {
    return this.repo.findDedupeCandidate(userId, params);
  }

  findPossibleDuplicate(
    userId: string,
    params: {
      accountId?: string | null;
      cardId?: string | null;
      amount: number;
      currency: string;
      type: 'DEBIT' | 'CREDIT';
      transactionDate: Date;
    },
  ) {
    return this.repo.findPossibleDuplicate(userId, params);
  }

  findLatestCategoryIdByMerchant(userId: string, merchant: string) {
    return this.repo.findLatestCategoryIdByMerchant(userId, merchant);
  }
}
