import type { DomainEventRelay } from '@personal-os/contracts';
import { DOMAIN_EVENT_RELAY } from '@personal-os/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  LEDGER_DELETION_REPOSITORY,
  LEDGER_QUERY_REPOSITORY,
} from '../../shared/application/tokens';
import type { LedgerDeletionRepositoryPort } from './ports/ledger-deletion.repository.port';
import type { LedgerQueryRepositoryPort } from './ports/ledger-query.repository.port';

/**
 * Hard-deletes a manual transaction (or transfer group). Balance compensation
 * and `finance.transaction.deleted` outbox rows run inside the repo TX.
 * Reverse keeps the row and emits `finance.transaction.reversed` instead.
 */
@Injectable()
export class DeleteTransactionUseCase {
  constructor(
    @Inject(LEDGER_DELETION_REPOSITORY)
    private readonly repo: LedgerDeletionRepositoryPort,
    @Inject(LEDGER_QUERY_REPOSITORY)
    private readonly query: LedgerQueryRepositoryPort,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
  ) {}

  async execute(userId: string, id: string) {
    const tx = await this.query.findTransactionById(id, userId);
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
      void this.relay.wake();
      return { success: true, undoId: tx.transferGroupId };
    }

    const result = await this.repo.deleteTransaction(userId, id);
    if (result.count === 0) {
      throw new NotFoundException('Transacción manual no encontrada');
    }
    void this.relay.wake();
    return { success: true, undoId: id };
  }
}
