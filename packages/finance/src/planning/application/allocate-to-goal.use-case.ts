import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateTransferUseCase } from '../../ledger/application/create-transfer.use-case';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { roundMoney } from '../../shared/domain/money';
import {
  EARMARK_EXCEEDS_BALANCE,
  EARMARK_EXCEEDS_BALANCE_MESSAGE,
  GOAL_ACCOUNT_REQUIRED,
  GOAL_ACCOUNT_REQUIRED_MESSAGE,
  GOAL_NOT_FOUND,
  GOAL_NOT_FOUND_MESSAGE,
} from '../../shared/domain/savings-goal';
import { PlanningRepository } from '../infrastructure/planning.repository';
import type { CreateSavingsGoalAllocationDto } from '../presentation/dto/create-savings-goal-allocation.dto';
import { mapSavingsGoalContribution } from './planning-mappers';

type GoalAccount = {
  name: string;
  currency: string;
  accountId: string | null;
  mode: 'EARMARK' | 'DEDICATED';
};

type SourceMovement = {
  transferGroupId: string;
  transactionId: string;
};

/**
 * Sets money aside for a goal. Money from another account reaches the goal
 * account first, and the allocation keeps the transfer linked, so removing the
 * allocation also removes the movement.
 */
@Injectable()
export class AllocateToGoalUseCase {
  constructor(
    private readonly repo: PlanningRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly createTransfer: CreateTransferUseCase,
  ) {}

  async execute(
    userId: string,
    goalId: string,
    dto: CreateSavingsGoalAllocationDto,
    now: Date,
  ) {
    const goal = await this.repo.findSavingsGoal(userId, goalId);
    if (!goal) {
      throw new NotFoundException({
        code: GOAL_NOT_FOUND,
        message: GOAL_NOT_FOUND_MESSAGE,
      });
    }

    const kind = dto.kind ?? 'CONTRIBUTION';
    const contributedAt = dto.date ? new Date(dto.date) : now;
    const accountId = goal.accountId;

    if (kind === 'CONTRIBUTION' && goal.mode === 'EARMARK' && !accountId) {
      throw new BadRequestException({
        code: GOAL_ACCOUNT_REQUIRED,
        message: GOAL_ACCOUNT_REQUIRED_MESSAGE,
      });
    }

    const sourceMovement =
      kind === 'CONTRIBUTION'
        ? await this.moveSourceMoney({ userId, goal, dto, contributedAt })
        : null;

    const allocation = await this.repo.addSavingsGoalContribution(
      goalId,
      {
        amount: dto.amount,
        contributedAt,
        kind,
        ...(accountId ? { accountId } : {}),
        ...(dto.fromTransferGroupId
          ? { transferGroupId: dto.fromTransferGroupId }
          : {}),
        ...(dto.transactionId ? { transactionId: dto.transactionId } : {}),
        ...(sourceMovement ?? {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      now,
    );
    return mapSavingsGoalContribution(allocation);
  }

  /**
   * A contribution from another account moves the money first. The free
   * balance is checked before the transfer, so no account goes negative and a
   * rejected allocation leaves no transfer behind.
   */
  private async moveSourceMoney(input: {
    userId: string;
    goal: GoalAccount;
    dto: CreateSavingsGoalAllocationDto;
    contributedAt: Date;
  }): Promise<SourceMovement | null> {
    const { userId, goal, dto, contributedAt } = input;
    if (!goal.accountId) {
      return null;
    }
    const sourceAccountId = dto.fromAccountId ?? goal.accountId;
    if (sourceAccountId === goal.accountId) {
      if (goal.mode === 'EARMARK') {
        await this.assertFreeBalance({
          userId,
          accountId: sourceAccountId,
          amount: dto.amount,
        });
      }
      return null;
    }
    await this.assertFreeBalance({
      userId,
      accountId: sourceAccountId,
      amount: dto.amount,
    });
    const transfer = await this.createTransfer.execute(userId, {
      fromAccountId: sourceAccountId,
      toAccountId: goal.accountId,
      amount: dto.amount,
      currency: goal.currency,
      transactionDate: contributedAt.toISOString(),
      description: `Aporte a ${goal.name}`,
    });
    return {
      transferGroupId: transfer.transferGroupId,
      transactionId: transfer.credit.id,
    };
  }

  /** An account only lends the balance no other goal has already claimed. */
  private async assertFreeBalance(input: {
    userId: string;
    accountId: string;
    amount: number;
  }) {
    const account = await this.ownership.assertAccountOwned(
      input.userId,
      input.accountId,
    );
    const earmarked = await this.repo.sumEarmarkedByAccount(
      input.userId,
      input.accountId,
    );
    if (
      roundMoney(earmarked + input.amount) >
      Number(account.balance) + 0.005
    ) {
      throw new ConflictException({
        code: EARMARK_EXCEEDS_BALANCE,
        message: EARMARK_EXCEEDS_BALANCE_MESSAGE,
      });
    }
  }
}
