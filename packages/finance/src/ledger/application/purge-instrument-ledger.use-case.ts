import { Inject, Injectable } from '@nestjs/common';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

@Injectable()
export class PurgeInstrumentLedgerUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async forAccount(userId: string, accountId: string) {
    const purged = await this.repo.purgeLedgerForAccount(userId, accountId);
    void this.outboxDispatcher.processBatch();
    return purged;
  }

  async forCard(userId: string, cardId: string) {
    const purged = await this.repo.purgeLedgerForCard(userId, cardId);
    void this.outboxDispatcher.processBatch();
    return purged;
  }
}
