import type { DomainEventRelay } from '@personal-os/contracts';
import { DOMAIN_EVENT_RELAY } from '@personal-os/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  LEDGER_STATUS_REPOSITORY,
  LEDGER_QUERY_REPOSITORY,
} from '../../shared/application/tokens';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerStatusRepositoryPort } from './ports/ledger-status.repository.port';
import type { LedgerQueryRepositoryPort } from './ports/ledger-query.repository.port';

@Injectable()
export class ConfirmTransactionUseCase {
  constructor(
    @Inject(LEDGER_STATUS_REPOSITORY)
    private readonly repo: LedgerStatusRepositoryPort,
    @Inject(LEDGER_QUERY_REPOSITORY)
    private readonly query: LedgerQueryRepositoryPort,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
  ) {}

  async execute(userId: string, id: string) {
    const tx = await this.query.findTransactionById(id, userId);
    if (!tx) {
      throw new NotFoundException('Transacción no encontrada');
    }

    if (tx.transferGroupId) {
      await this.repo.confirmTransactionsByTransferGroupId(
        userId,
        tx.transferGroupId,
      );
      const refreshed = await this.query.findTransactionById(id, userId);
      if (!refreshed) {
        throw new NotFoundException('Transacción no encontrada');
      }
      void this.relay.wake();
      return mapLedgerTransaction(refreshed);
    }

    const updated = await this.repo.confirmTransaction(userId, id);
    if (!updated) {
      throw new NotFoundException('Transacción no encontrada');
    }
    void this.relay.wake();
    return mapLedgerTransaction(updated.transaction);
  }
}
