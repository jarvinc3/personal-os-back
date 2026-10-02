import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import { mapLedgerTransaction } from './ledger-mappers';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

@Injectable()
export class ReverseTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
  ) {}

  async execute(userId: string, originalId: string, aiMetadata?: unknown) {
    const result = await this.repo.reverseTransaction(
      userId,
      originalId,
      aiMetadata,
    );
    if (!result) {
      throw new NotFoundException('Transaction not found');
    }
    void this.outboxDispatcher.processBatch();
    return mapLedgerTransaction(result.transaction);
  }
}
