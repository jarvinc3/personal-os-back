import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { PlanningRepository } from '../infrastructure/planning.repository';
import type { CreateSavingsGoalContributionDto } from '../presentation/dto/create-savings-goal-contribution.dto';
import { mapSavingsGoalContribution } from './planning-mappers';

type MovementInput = {
  userId: string;
  goalName: string;
  currency: string;
  accountId: string;
  amount: number;
  contributedAt: Date;
};

/**
 * A contribution leaves the chosen account as a real expense and counts as
 * saved in the goal.
 */
@Injectable()
export class RecordSavingsGoalContributionUseCase {
  constructor(
    private readonly repo: PlanningRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly createTransaction: CreateTransactionUseCase,
  ) {}

  async execute(
    userId: string,
    goalId: string,
    dto: CreateSavingsGoalContributionDto,
    now: Date,
  ) {
    const goal = await this.repo.findSavingsGoal(userId, goalId);
    if (!goal) {
      throw new NotFoundException('Savings goal not found');
    }

    const contributedAt = dto.contributedAt ? new Date(dto.contributedAt) : now;
    const transactionId = await this.createMovement({
      userId,
      goalName: goal.name,
      currency: goal.currency,
      accountId: dto.accountId,
      amount: dto.amount,
      contributedAt,
    });

    const contribution = await this.repo.addSavingsGoalContribution(
      goalId,
      {
        amount: dto.amount,
        contributedAt,
        accountId: dto.accountId,
        transactionId,
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      now,
    );
    return mapSavingsGoalContribution(contribution);
  }

  private async createMovement({
    userId,
    goalName,
    currency,
    accountId,
    amount,
    contributedAt,
  }: MovementInput): Promise<string> {
    await this.ownership.assertAccountOwned(userId, accountId);
    const movement = await this.createTransaction.execute(userId, {
      accountId,
      type: 'DEBIT',
      amount,
      currency,
      transactionDate: contributedAt.toISOString(),
      description: `Aporte: ${goalName}`,
    });
    return movement.id;
  }
}
