import { Injectable, NotFoundException } from '@nestjs/common';
import { DeleteTransactionUseCase } from '../../ledger/application/delete-transaction.use-case';
import { PlanningRepository } from '../infrastructure/planning.repository';

type RemoveSavingsGoalContributionCommand = {
  userId: string;
  goalId: string;
  contributionId: string;
  now: Date;
};

/** Removing a contribution also removes the movement it created. */
@Injectable()
export class RemoveSavingsGoalContributionUseCase {
  constructor(
    private readonly repo: PlanningRepository,
    private readonly deleteTransaction: DeleteTransactionUseCase,
  ) {}

  async execute({
    userId,
    goalId,
    contributionId,
    now,
  }: RemoveSavingsGoalContributionCommand) {
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
      const movement = await this.repo.findTransactionByTransferGroupId(
        userId,
        contribution.transferGroupId,
      );
      if (movement) {
        await this.deleteTransaction.execute(userId, movement.id);
      }
    }
    await this.repo.removeSavingsGoalContribution(goalId, contributionId, now);
    return { success: true };
  }
}
