import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { paginate } from '../../../../core/pagination/pagination.dto';
import { LogoService } from '../../../logos/application/logo.service';
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
    private readonly logos: LogoService,
  ) {}

  async listTransactions(userId: string, query: ListTransactionsQuery) {
    const [items, total] = await this.repo.findTransactions(userId, query);
    await this.logos.ensureCardNetworks();
    return paginate(
      items.map((item) => mapLogicalTransaction(item, undefined, this.logos)),
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
    await this.logos.ensureCardNetworks();
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

  findLatestCategoryIdByMerchant(userId: string, merchant: string) {
    return this.repo.findLatestCategoryIdByMerchant(userId, merchant);
  }
}
