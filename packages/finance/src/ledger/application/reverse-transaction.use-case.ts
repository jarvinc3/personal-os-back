import type { DomainEventRelay } from '@personal-os/contracts';
import { DOMAIN_EVENT_RELAY } from '@personal-os/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

@Injectable()
export class ReverseTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
  ) {}

  async execute(userId: string, originalId: string, aiMetadata?: unknown) {
    const result = await this.repo.reverseTransaction(
      userId,
      originalId,
      aiMetadata,
    );
    if (!result) {
      throw new NotFoundException('Transacción no encontrada');
    }
    void this.relay.wake();
    return mapLedgerTransaction(result.transaction);
  }
}
