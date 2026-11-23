import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LEDGER_QUERY_REPOSITORY } from '../../shared/application/tokens';
import { DeleteTransactionUseCase } from './delete-transaction.use-case';
import type { LedgerQueryRepositoryPort } from './ports/ledger-query.repository.port';

/**
 * Merges a possible duplicate into the movement it points at: the duplicate is
 * deleted through the journal (with balance compensation) and the other stays.
 */
@Injectable()
export class MergeTransactionUseCase {
  constructor(
    @Inject(LEDGER_QUERY_REPOSITORY)
    private readonly repo: LedgerQueryRepositoryPort,
    private readonly deleteTransaction: DeleteTransactionUseCase,
  ) {}

  async execute(
    userId: string,
    duplicateId: string,
    intoId: string,
  ): Promise<{ success: true }> {
    const keeper = await this.repo.findTransactionById(intoId, userId);
    if (!keeper) {
      throw new NotFoundException('Transacción no encontrada');
    }
    await this.deleteTransaction.execute(userId, duplicateId);
    return { success: true };
  }
}
