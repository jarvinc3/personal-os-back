import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateTransferUseCase } from '../../ledger/application/create-transfer.use-case';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { resolveLocalMoment } from '../../shared/domain/local-day';
import { roundMoney } from '../../shared/domain/money';
import {
  EARMARK_EXCEEDS_BALANCE,
  EARMARK_EXCEEDS_BALANCE_MESSAGE,
  GOAL_ACCOUNT_REQUIRED,
  GOAL_ACCOUNT_REQUIRED_MESSAGE,
  GOAL_NOT_FOUND,
  GOAL_NOT_FOUND_MESSAGE,
  GOAL_WITHDRAWAL_ACCOUNT_REQUIRED,
  GOAL_WITHDRAWAL_ACCOUNT_REQUIRED_MESSAGE,
  GOAL_WITHDRAWAL_EXCEEDS_AVAILABLE,
  GOAL_WITHDRAWAL_EXCEEDS_AVAILABLE_MESSAGE,
} from '../../shared/domain/savings-goal';
import { PlanningRepository } from '../infrastructure/planning.repository';
import type { CreateSavingsGoalAllocationDto } from '../presentation/dto/create-savings-goal-allocation.dto';
import { mapSavingsGoalContribution } from './planning-mappers';

type GoalAllocation = {
  name: string;
  currency: string;
  accountId: string | null;
  currentAmount: unknown;
  mode: 'EARMARK' | 'DEDICATED';
};

type AllocationMovement = {
  transferGroupId?: string;
  transactionId?: string;
};

/**
 * Sets money aside for a goal or returns it to an account. A contribution from
 * another account reaches the goal account first; a withdrawal leaves it for
 * the chosen destination. The allocation keeps the transfer linked, so removing
 * the allocation also removes the movement.
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
    const contributedAt = resolveLocalMoment({
      timezone: await this.repo.findUserTimezone(userId),
      date: dto.date,
      now,
    });
    const accountId = goal.accountId;

    if (kind === 'CONTRIBUTION' && goal.mode === 'EARMARK' && !accountId) {
      throw new BadRequestException({
        code: GOAL_ACCOUNT_REQUIRED,
        message: GOAL_ACCOUNT_REQUIRED_MESSAGE,
      });
    }

    const movement =
      kind === 'CONTRIBUTION'
        ? await this.moveSourceMoney({ userId, goal, dto, contributedAt })
        : await this.moveWithdrawalMoney({ userId, goal, dto, contributedAt });

    const allocation = await this.repo.addSavingsGoalContribution(
      goalId,
      {
        amount: dto.amount,
        contributedAt,
        kind,
        ...(accountId ? { accountId } : {}),
        ...(kind === 'WITHDRAWAL' && dto.toAccountId
          ? { destinationAccountId: dto.toAccountId }
          : {}),
        ...(dto.fromTransferGroupId
          ? { transferGroupId: dto.fromTransferGroupId }
          : {}),
        ...(dto.transactionId ? { transactionId: dto.transactionId } : {}),
        ...(movement?.transferGroupId
          ? { transferGroupId: movement.transferGroupId }
          : {}),
        ...(movement?.transactionId
          ? { transactionId: movement.transactionId }
          : {}),
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
    goal: GoalAllocation;
    dto: CreateSavingsGoalAllocationDto;
    contributedAt: Date;
  }): Promise<AllocationMovement | null> {
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

  /**
   * A withdrawal returns money from the goal account to the chosen account.
   * The allocation keeps only the transfer group, so the goal always subtracts
   * the amount even when spending does not reduce progress.
   */
  private async moveWithdrawalMoney(input: {
    userId: string;
    goal: GoalAllocation;
    dto: CreateSavingsGoalAllocationDto;
    contributedAt: Date;
  }): Promise<AllocationMovement | null> {
    const { userId, goal, dto, contributedAt } = input;
    if (!goal.accountId) {
      throw new BadRequestException({
        code: GOAL_ACCOUNT_REQUIRED,
        message: GOAL_ACCOUNT_REQUIRED_MESSAGE,
      });
    }
    if (!dto.toAccountId) {
      throw new BadRequestException({
        code: GOAL_WITHDRAWAL_ACCOUNT_REQUIRED,
        message: GOAL_WITHDRAWAL_ACCOUNT_REQUIRED_MESSAGE,
      });
    }

    const destinationAccount = await this.ownership.assertAccountOwned(
      userId,
      dto.toAccountId,
    );
    if (!destinationAccount.isActive) {
      throw new BadRequestException('La cuenta de destino está archivada');
    }
    if (destinationAccount.currency !== goal.currency) {
      throw new BadRequestException(
        'La cuenta de destino debe estar en la moneda de la meta',
      );
    }

    const available = roundMoney(Number(goal.currentAmount));
    if (roundMoney(dto.amount) > available + 0.005) {
      throw new ConflictException({
        code: GOAL_WITHDRAWAL_EXCEEDS_AVAILABLE,
        message: GOAL_WITHDRAWAL_EXCEEDS_AVAILABLE_MESSAGE,
        max: available,
      });
    }
    if (dto.toAccountId === goal.accountId) {
      return null;
    }

    const transfer = await this.createTransfer.execute(userId, {
      fromAccountId: goal.accountId,
      toAccountId: dto.toAccountId,
      amount: dto.amount,
      currency: goal.currency,
      transactionDate: contributedAt.toISOString(),
      description: `Retiro de ${goal.name}`,
    });
    return { transferGroupId: transfer.transferGroupId };
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
