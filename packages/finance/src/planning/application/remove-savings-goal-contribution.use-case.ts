import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DeleteTransactionUseCase } from '../../ledger/application/delete-transaction.use-case';
import type { LedgerQueryRepositoryPort } from '../../ledger/application/ports/ledger-query.repository.port';
import { LEDGER_QUERY_REPOSITORY } from '../../shared/application/tokens';
import { PlanningSavingsGoalRepository } from '../infrastructure/planning-savings-goal.repository';

/** Removing a contribution also removes the movement it created. */
@Injectable()
export class RemoveSavingsGoalContributionUseCase {
  constructor(
    private readonly repo: PlanningSavingsGoalRepository,
    @Inject(LEDGER_QUERY_REPOSITORY)
    private readonly movements: LedgerQueryRepositoryPort,
    private readonly deleteTransaction: DeleteTransactionUseCase,
  ) {}

  async execute(
    userId: string,
    goalId: string,
    contributionId: string,
    now: Date,
  ) {
    const goal = await this.repo.findSavingsGoal(userId, goalId);
    if (!goal) {
      throw new NotFoundException('Meta de ahorro no encontrada');
    }
    const contribution = await this.repo.findSavingsGoalContribution(
      goalId,
      contributionId,
    );
    if (!contribution) {
      throw new NotFoundException('Aporte no encontrado');
    }

    if (contribution.transactionId) {
      await this.deleteTransaction.execute(userId, contribution.transactionId);
    } else if (contribution.transferGroupId) {
      const [movement] = await this.movements.findTransactionsByTransferGroupId(
        contribution.transferGroupId,
        userId,
      );
      if (movement) {
        await this.deleteTransaction.execute(userId, movement.id);
      }
    }
    await this.repo.removeSavingsGoalContribution(goalId, contributionId, now);
    return { success: true };
  }
}
