import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

/**
 * Hard-deletes a manual transaction (or transfer group). Balance compensation
 * and `finance.transaction.deleted` outbox rows run inside the repo TX.
 * Reverse keeps the row and emits `finance.transaction.reversed` instead.
 */
@Injectable()
export class DeleteTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(userId: string, id: string) {
    const tx = await this.repo.findTransactionById(id, userId);
    if (!tx) {
      throw new NotFoundException('Transacción manual no encontrada');
    }

    if (tx.transferGroupId) {
      const result = await this.repo.deleteTransactionsByTransferGroupId(
        userId,
        tx.transferGroupId,
      );
      if (result.count === 0) {
        throw new NotFoundException('Transacción manual no encontrada');
      }
      void this.outboxDispatcher.processBatch();
      return { success: true, undoId: tx.transferGroupId };
    }

    const result = await this.repo.deleteTransaction(userId, id);
    if (result.count === 0) {
      throw new NotFoundException('Transacción manual no encontrada');
    }
    void this.outboxDispatcher.processBatch();
    return { success: true, undoId: id };
  }
}
