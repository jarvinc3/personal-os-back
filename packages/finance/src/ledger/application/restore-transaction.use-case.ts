import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

/** Undoes a transaction delete from its journal snapshot. */
@Injectable()
export class RestoreTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
  ) {}

  async execute(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreTransaction(userId, id, now);
    if (restored.count === 0) {
      throw new NotFoundException('Transaction not found');
    }
    return { success: true };
  }
}
