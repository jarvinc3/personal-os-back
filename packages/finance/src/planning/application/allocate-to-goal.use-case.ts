import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

/**
 * Sets money aside for a goal. An allocation never moves money: it only marks
 * part of an account balance as saved.
 */
@Injectable()
export class AllocateToGoalUseCase {
  constructor(
    private readonly repo: PlanningRepository,
    private readonly ownership: FinanceOwnershipService,
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

    if (kind === 'CONTRIBUTION' && goal.mode === 'EARMARK') {
      if (!accountId) {
        throw new BadRequestException({
          code: GOAL_ACCOUNT_REQUIRED,
          message: GOAL_ACCOUNT_REQUIRED_MESSAGE,
        });
      }
      const account = await this.ownership.assertAccountOwned(
        userId,
        accountId,
      );
      const earmarked = await this.repo.sumEarmarkedByAccount(
        userId,
        accountId,
      );
      if (
        roundMoney(earmarked + dto.amount) >
        Number(account.balance) + 0.005
      ) {
        throw new ConflictException({
          code: EARMARK_EXCEEDS_BALANCE,
          message: EARMARK_EXCEEDS_BALANCE_MESSAGE,
        });
      }
    }

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
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      now,
    );
    return mapSavingsGoalContribution(allocation);
  }
}
