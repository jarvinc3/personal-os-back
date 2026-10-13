import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import { DeleteTransactionUseCase } from './delete-transaction.use-case';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

/**
 * Merges a possible duplicate into the movement it points at: the duplicate is
 * deleted through the journal (with balance compensation) and the other stays.
 */
@Injectable()
export class MergeTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly repo: LedgerRepositoryPort,
    private readonly deleteTransaction: DeleteTransactionUseCase,
  ) {}

  async execute(
    userId: string,
    duplicateId: string,
    intoId: string,
  ): Promise<void> {
    const keeper = await this.repo.findTransactionById(intoId, userId);
    if (!keeper) {
      throw new NotFoundException('Transaction not found');
    }
    await this.deleteTransaction.execute(userId, duplicateId);
  }
}
