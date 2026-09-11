import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { paginate } from '../../../../core/pagination/pagination.dto';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import type { ListTransactionsQuery } from './commands/ledger.commands';
import { mapLogicalTransaction } from './ledger-mappers';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

/**
 * Read-only ledger queries for HTTP and façade consumers.
 */
@Injectable()
export class LedgerQueryService {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
  ) {}

  async listTransactions(userId: string, query: ListTransactionsQuery) {
    const [items, total] = await this.repo.findTransactions(userId, query);
    return paginate(
      items.map((item) => mapLogicalTransaction(item)),
      total,
      {
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      },
    );
  }

  async getTransaction(userId: string, id: string) {
    const tx = await this.repo.findTransactionById(id, userId);
    if (!tx) throw new NotFoundException('Transaction not found');
    if (!tx.transferGroupId) {
      return mapLogicalTransaction(tx);
    }
    const legs = await this.repo.findTransactionsByTransferGroupId(
      tx.transferGroupId,
      userId,
    );
    const counterpart = legs.find((leg) => leg.id !== tx.id) ?? null;
    return mapLogicalTransaction(tx, counterpart);
  }

  findTransactionByEmailMessageId(gmailMessageId: string, userId?: string) {
    return this.repo.findTransactionByEmailMessageId(gmailMessageId, userId);
  }

  findReverseCandidates(
    userId: string,
    params: {
      amount: number;
      currency: string;
      merchant: string | null;
      aroundDate: Date;
    },
  ) {
    return this.repo.findCandidatesForReverse(userId, params);
  }
}
