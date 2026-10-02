import {
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

@Injectable()
export class ConfirmTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(userId: string, id: string) {
    const tx = await this.repo.findTransactionById(id, userId);
    if (!tx) throw new NotFoundException('Transaction not found');

    if (tx.transferGroupId) {
      await this.repo.confirmTransactionsByTransferGroupId(
        userId,
        tx.transferGroupId,
      );
      const refreshed = await this.repo.findTransactionById(id, userId);
      if (!refreshed) throw new NotFoundException('Transaction not found');
      void this.outboxDispatcher.processBatch();
      return mapLedgerTransaction(refreshed);
    }

    const updated = await this.repo.confirmTransaction(userId, id);
    if (!updated) throw new NotFoundException('Transaction not found');
    void this.outboxDispatcher.processBatch();
    return mapLedgerTransaction(updated.transaction);
  }
}
