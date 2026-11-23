import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  clampPageLimit,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { assertRestored } from '../../shared/application/assert-restored';
import { PlanningSavingsGoalRepository } from '../infrastructure/planning-savings-goal.repository';
import type { CreateSavingsGoalDto } from '../presentation/dto/create-savings-goal.dto';
import type { UpdateSavingsGoalDto } from '../presentation/dto/update-savings-goal.dto';
import { mapSavingsGoal, mapSavingsGoalContribution } from './planning-mappers';
import { savingsGoalUpdateFields } from './planning-savings-goal-changes';

/** Savings goals of a user and the contributions that feed their balance. */
export class PlanningSavingsGoals {
  constructor(
    private readonly repo: PlanningSavingsGoalRepository,
    private readonly ownership: FinanceOwnershipService,
  ) {}

  async listSavingsGoals(userId: string) {
    const rows = await this.repo.listSavingsGoals(userId);
    return rows.map(mapSavingsGoal);
  }

  async listSavingsGoalsPage(userId: string, query: CursorQueryDto) {
    const rows = await this.repo.listSavingsGoalsPage(userId, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.createdAt.toISOString(),
    );
    return { ...page, items: page.items.map(mapSavingsGoal) };
  }

  async getSavingsGoal(userId: string, id: string) {
    const row = await this.repo.findSavingsGoal(userId, id);
    if (!row) {
      throw new NotFoundException('Meta de ahorro no encontrada');
    }
    return mapSavingsGoal(row);
  }

  async lookupSavingsGoals(userId: string, ids: readonly string[]) {
    const rows = await this.repo.findSavingsGoalsByIds(userId, ids);
    return new Map(rows.map((row) => [row.id, mapSavingsGoal(row)]));
  }

  async createSavingsGoal(
    userId: string,
    dto: CreateSavingsGoalDto,
    now: Date,
  ) {
    const currency = dto.currency ?? 'DOP';
    await this.assertGoalAccount(userId, dto.accountId, currency);
    const created = await this.repo.createSavingsGoal({
      userId,
      data: {
        name: dto.name.trim(),
        description: dto.description,
        targetAmount: dto.targetAmount,
        currency,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        accountId: dto.accountId,
        mode: dto.mode ?? 'EARMARK',
        spendReducesProgress: dto.spendReducesProgress ?? true,
      },
      openingAmount: dto.currentAmount ?? 0,
      now,
    });
    return mapSavingsGoal(created);
  }

  // Public signature fixed by the controller and the tests; the repository
  // still receives the partial payload built by the changes file.
  // eslint-disable-next-line max-params
  async updateSavingsGoal(
    userId: string,
    id: string,
    dto: UpdateSavingsGoalDto,
    now: Date,
  ) {
    const existing = await this.repo.findSavingsGoal(userId, id);
    if (!existing) {
      throw new NotFoundException('Meta de ahorro no encontrada');
    }
    const nextCurrency = dto.currency ?? existing.currency;
    const nextAccountId = dto.accountId ?? existing.accountId;
    if (nextAccountId) {
      await this.assertGoalAccount(userId, nextAccountId, nextCurrency);
    }
    await this.repo.updateSavingsGoal({
      userId,
      id,
      data: savingsGoalUpdateFields(dto),
      now,
    });
    const saved = await this.repo.findSavingsGoal(userId, id);
    if (!saved) {
      throw new NotFoundException('Meta de ahorro no encontrada');
    }
    return mapSavingsGoal(saved);
  }

  async deleteSavingsGoal(userId: string, id: string) {
    const deleted = await this.repo.deleteSavingsGoal(userId, id);
    if (deleted.count === 0) {
      throw new NotFoundException('Meta de ahorro no encontrada');
    }
    return { success: true };
  }

  async restoreSavingsGoal(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreSavingsGoal(userId, id, now);
    assertRestored(restored, 'Savings goal not found');
    return { success: true };
  }

  async listSavingsGoalContributions(
    userId: string,
    id: string,
    query: CursorQueryDto,
  ) {
    await this.assertSavingsGoalOwned(userId, id);
    const rows = await this.repo.listSavingsGoalContributions(id, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.contributedAt.toISOString(),
    );
    return { ...page, items: page.items.map(mapSavingsGoalContribution) };
  }

  private async assertGoalAccount(
    userId: string,
    accountId: string,
    currency: string,
  ): Promise<void> {
    const account = await this.ownership.assertAccountOwned(userId, accountId);
    if (account.currency !== currency) {
      throw new BadRequestException(
        'La cuenta de la meta debe estar en la moneda de la meta',
      );
    }
  }

  private async assertSavingsGoalOwned(
    userId: string,
    id: string,
  ): Promise<void> {
    const goal = await this.repo.findSavingsGoal(userId, id);
    if (!goal) {
      throw new NotFoundException('Meta de ahorro no encontrada');
    }
  }
}
