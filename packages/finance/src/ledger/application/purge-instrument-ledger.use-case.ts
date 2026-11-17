import type { DomainEventRelay } from '@personal-os/contracts';
import { DOMAIN_EVENT_RELAY } from '@personal-os/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

@Injectable()
export class PurgeInstrumentLedgerUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    @Inject(DOMAIN_EVENT_RELAY)
    private readonly relay: DomainEventRelay,
  ) {}

  async forAccount(userId: string, accountId: string) {
    const purged = await this.repo.purgeLedgerForAccount(userId, accountId);
    void this.relay.wake();
    return purged;
  }

  async forCard(userId: string, cardId: string) {
    const purged = await this.repo.purgeLedgerForCard(userId, cardId);
    void this.relay.wake();
    return purged;
  }
}
