import { Injectable, NotFoundException } from '@nestjs/common';
import { DeleteTransactionUseCase } from '../../ledger/application/delete-transaction.use-case';
import { PlanningRepository } from '../infrastructure/planning.repository';

/** Removing a contribution also removes the movement it created. */
@Injectable()
export class RemoveSavingsGoalContributionUseCase {
  constructor(
    private readonly repo: PlanningRepository,
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
      throw new NotFoundException('Savings goal not found');
    }
    const contribution = await this.repo.findSavingsGoalContribution(
      goalId,
      contributionId,
    );
    if (!contribution) {
      throw new NotFoundException('Contribution not found');
    }

    if (contribution.transactionId) {
      await this.deleteTransaction.execute(userId, contribution.transactionId);
    }
    await this.repo.removeSavingsGoalContribution(goalId, contributionId, now);
    return { success: true };
  }
}
