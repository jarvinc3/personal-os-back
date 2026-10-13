import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  clampPageLimit,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { assertRestored } from '../../shared/application/assert-restored';
import { PlanningRepository } from '../infrastructure/planning.repository';
import type { CreateBudgetDto } from '../presentation/dto/create-budget.dto';
import type { CreateLoanDto } from '../presentation/dto/create-loan.dto';
import type { CreateReceivableDto } from '../presentation/dto/create-receivable.dto';
import type { CreateSavingsGoalDto } from '../presentation/dto/create-savings-goal.dto';
import type { UpdateBudgetDto } from '../presentation/dto/update-budget.dto';
import type { UpdateLoanDto } from '../presentation/dto/update-loan.dto';
import type { UpdateReceivableDto } from '../presentation/dto/update-receivable.dto';
import type { UpdateSavingsGoalDto } from '../presentation/dto/update-savings-goal.dto';
import {
  mapBudget,
  mapLoan,
  mapLoanInstallment,
  mapReceivable,
  mapReceivablePayment,
  mapSavingsGoal,
  mapSavingsGoalContribution,
} from './planning-mappers';
import { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';

@Injectable()
export class PlanningService {
  constructor(
    private readonly repo: PlanningRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly syncInstallments: SyncLoanInstallmentsUseCase,
  ) {}

  async listBudgets(userId: string) {
    const rows = await this.repo.listBudgets(userId);
    return rows.map(mapBudget);
  }

  async listBudgetsPage(userId: string, query: CursorQueryDto) {
    const rows = await this.repo.listBudgetsPage(userId, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.periodStart.toISOString(),
    );
    return { ...page, items: page.items.map(mapBudget) };
  }

  async getBudget(userId: string, id: string) {
    const row = await this.repo.findBudget(userId, id);
    if (!row) {
      throw new NotFoundException('Budget not found');
    }
    return mapBudget(row);
  }

  async createBudget(userId: string, dto: CreateBudgetDto) {
    const categoryIds = dto.categoryIds;
    for (const categoryId of categoryIds) {
      await this.ownership.assertExpenseCategory(userId, categoryId);
    }
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    await this.assertCategoriesNotBudgeted(
      userId,
      categoryIds,
      periodStart,
      periodEnd,
    );
    const created = await this.repo.createBudget(
      userId,
      {
        categoryId: categoryIds[0],
        name: dto.name ?? null,
        includeChildren: dto.includeChildren ?? true,
        rollover: dto.rollover ?? 'NONE',
        recurring: dto.recurring ?? false,
        periodType: dto.periodType,
        periodStart,
        periodEnd,
        amountLimit: dto.amountLimit,
        amountSpent: 0,
        alertThresholdPct: dto.alertThresholdPct ?? 80,
      },
      categoryIds,
    );
    if (!created) {
      throw new NotFoundException('Budget not found');
    }
    return mapBudget(created);
  }

  async updateBudget(userId: string, id: string, dto: UpdateBudgetDto) {
    if (dto.categoryIds) {
      for (const categoryId of dto.categoryIds) {
        await this.ownership.assertExpenseCategory(userId, categoryId);
      }
      const existing = await this.repo.findBudget(userId, id);
      if (!existing) {
        throw new NotFoundException('Budget not found');
      }
      await this.assertCategoriesNotBudgeted(
        userId,
        dto.categoryIds,
        dto.periodStart ? new Date(dto.periodStart) : existing.periodStart,
        dto.periodEnd ? new Date(dto.periodEnd) : existing.periodEnd,
        id,
      );
    }
    const updated = await this.repo.updateBudget(
      userId,
      id,
      {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.categoryIds ? { categoryId: dto.categoryIds[0] } : {}),
        ...(dto.periodType ? { periodType: dto.periodType } : {}),
        ...(dto.periodStart ? { periodStart: new Date(dto.periodStart) } : {}),
        ...(dto.periodEnd ? { periodEnd: new Date(dto.periodEnd) } : {}),
        ...(dto.amountLimit !== undefined
          ? { amountLimit: dto.amountLimit }
          : {}),
        ...(dto.alertThresholdPct !== undefined
          ? { alertThresholdPct: dto.alertThresholdPct }
          : {}),
        ...(dto.includeChildren !== undefined
          ? { includeChildren: dto.includeChildren }
          : {}),
        ...(dto.rollover ? { rollover: dto.rollover } : {}),
        ...(dto.recurring !== undefined ? { recurring: dto.recurring } : {}),
      },
      dto.categoryIds,
    );
    if (!updated) {
      throw new NotFoundException('Budget not found');
    }
    return mapBudget(updated);
  }

  private async assertCategoriesNotBudgeted(
    userId: string,
    categoryIds: string[],
    periodStart: Date,
    periodEnd: Date,
    excludeBudgetId?: string,
  ): Promise<void> {
    const conflict = await this.repo.findOverlappingBudgetForCategories(
      userId,
      categoryIds,
      periodStart,
      periodEnd,
      excludeBudgetId,
    );
    if (!conflict) {
      return;
    }
    const conflicting = conflict.categories.find((entry) =>
      categoryIds.includes(entry.categoryId),
    );
    throw new ConflictException({
      code: 'CATEGORY_ALREADY_BUDGETED',
      message: `${conflicting?.category.name ?? 'Una categoría'} ya está en el presupuesto ${conflict.name ?? 'de este periodo'}.`,
    });
  }

  async deleteBudget(userId: string, id: string) {
    const result = await this.repo.deleteBudget(userId, id);
    if (result.count === 0) {
      throw new NotFoundException('Budget not found');
    }
    return { success: true };
  }

  async restoreBudget(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreBudget(userId, id, now);
    assertRestored(restored, 'Budget not found');
    return { success: true };
  }

  async listSavingsGoals(userId: string) {
    const rows = await this.repo.listSavingsGoals(userId);
    return rows.map(mapSavingsGoal);
  }

  async getSavingsGoal(userId: string, id: string) {
    const row = await this.repo.findSavingsGoal(userId, id);
    if (!row) {
      throw new NotFoundException('Savings goal not found');
    }
    return mapSavingsGoal(row);
  }

  async createSavingsGoal(
    userId: string,
    dto: CreateSavingsGoalDto,
    now: Date,
  ) {
    const created = await this.repo.createSavingsGoal(
      userId,
      {
        name: dto.name,
        description: dto.description,
        targetAmount: dto.targetAmount,
        currency: dto.currency ?? 'DOP',
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        accountId: dto.accountId,
        mode: dto.mode ?? 'EARMARK',
      },
      dto.currentAmount ?? 0,
      now,
    );
    return mapSavingsGoal(created);
  }

  async updateSavingsGoal(
    userId: string,
    id: string,
    dto: UpdateSavingsGoalDto,
    now: Date,
  ) {
    await this.assertSavingsGoalOwned(userId, id);
    await this.repo.updateSavingsGoal(
      userId,
      id,
      {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.targetAmount !== undefined
          ? { targetAmount: dto.targetAmount }
          : {}),
        ...(dto.currency ? { currency: dto.currency } : {}),
        ...(dto.targetDate ? { targetDate: new Date(dto.targetDate) } : {}),
      },
      now,
    );
    const saved = await this.repo.findSavingsGoal(userId, id);
    if (!saved) {
      throw new NotFoundException('Savings goal not found');
    }
    return mapSavingsGoal(saved);
  }

  async deleteSavingsGoal(userId: string, id: string) {
    const result = await this.repo.deleteSavingsGoal(userId, id);
    if (result.count === 0) {
      throw new NotFoundException('Savings goal not found');
    }
    return { success: true };
  }

  async restoreSavingsGoal(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreSavingsGoal(userId, id, now);
    assertRestored(restored, 'Savings goal not found');
    return { success: true };
  }

  async listSavingsGoalContributions(userId: string, id: string) {
    await this.assertSavingsGoalOwned(userId, id);
    const rows = await this.repo.listSavingsGoalContributions(id);
    return rows.map(mapSavingsGoalContribution);
  }

  private async assertSavingsGoalOwned(
    userId: string,
    id: string,
  ): Promise<void> {
    const goal = await this.repo.findSavingsGoal(userId, id);
    if (!goal) {
      throw new NotFoundException('Savings goal not found');
    }
  }

  async listLoans(userId: string) {
    const rows = await this.repo.listLoans(userId);
    return rows.map(mapLoan);
  }

  async getLoan(userId: string, id: string) {
    const row = await this.repo.findLoan(userId, id);
    if (!row) {
      throw new NotFoundException('Loan not found');
    }
    return mapLoan(row);
  }

  async listLoanInstallments(userId: string, id: string) {
    const loan = await this.repo.findLoan(userId, id);
    if (!loan) {
      throw new NotFoundException('Loan not found');
    }
    const rows = await this.repo.listInstallments(id);
    return rows.map(mapLoanInstallment);
  }

  async createLoan(userId: string, dto: CreateLoanDto, now: Date) {
    if (dto.institutionId) {
      await this.ownership.assertInstitutionOwned(userId, dto.institutionId);
    }
    if (dto.accountId) {
      await this.ownership.assertLoanAccountAlignment({
        userId,
        accountId: dto.accountId,
        institutionId: dto.institutionId,
      });
    }
    const created = await this.repo.createLoan(userId, {
      lenderName: dto.lenderName,
      institutionId: dto.institutionId,
      accountId: dto.accountId,
      originalAmount: dto.originalAmount,
      currentBalance: dto.currentBalance,
      currency: dto.currency ?? 'DOP',
      installmentAmount: dto.installmentAmount,
      installmentFreq: dto.installmentFreq,
      totalInstallments: dto.totalInstallments,
      paidInstallments: dto.paidInstallments ?? 0,
      nextDueDate: new Date(dto.nextDueDate),
      ...(dto.interestRate !== undefined
        ? { interestRate: dto.interestRate }
        : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    });
    await this.syncInstallments.execute(created, now);
    return mapLoan(created);
  }

  async updateLoan(userId: string, id: string, dto: UpdateLoanDto, now: Date) {
    const existing = await this.repo.findLoan(userId, id);
    if (!existing) {
      throw new NotFoundException('Loan not found');
    }

    const nextInstitutionId =
      dto.institutionId !== undefined
        ? dto.institutionId
        : existing.institutionId;
    const nextAccountId =
      dto.accountId !== undefined ? dto.accountId : existing.accountId;

    if (dto.institutionId) {
      await this.ownership.assertInstitutionOwned(userId, dto.institutionId);
    }
    if (nextAccountId) {
      await this.ownership.assertLoanAccountAlignment({
        userId,
        accountId: nextAccountId,
        institutionId: nextInstitutionId,
      });
    }

    const nextOriginalAmount = Number(existing.originalAmount);
    const nextCurrentBalance =
      dto.currentBalance !== undefined
        ? dto.currentBalance
        : Number(existing.currentBalance);
    if (nextCurrentBalance > nextOriginalAmount) {
      throw new BadRequestException(
        'currentBalance must not exceed originalAmount',
      );
    }

    const nextTotalInstallments =
      dto.totalInstallments !== undefined
        ? dto.totalInstallments
        : existing.totalInstallments;
    const nextPaidInstallments =
      dto.paidInstallments !== undefined
        ? dto.paidInstallments
        : existing.paidInstallments;
    if (nextPaidInstallments > nextTotalInstallments) {
      throw new BadRequestException(
        'paidInstallments must not exceed totalInstallments',
      );
    }

    const updated = await this.repo.updateLoan(userId, id, {
      ...(dto.lenderName ? { lenderName: dto.lenderName } : {}),
      ...(dto.institutionId !== undefined
        ? { institutionId: dto.institutionId }
        : {}),
      ...(dto.accountId !== undefined ? { accountId: dto.accountId } : {}),
      ...(dto.currentBalance !== undefined
        ? { currentBalance: dto.currentBalance }
        : {}),
      ...(dto.installmentAmount !== undefined
        ? { installmentAmount: dto.installmentAmount }
        : {}),
      ...(dto.installmentFreq ? { installmentFreq: dto.installmentFreq } : {}),
      ...(dto.totalInstallments !== undefined
        ? { totalInstallments: dto.totalInstallments }
        : {}),
      ...(dto.paidInstallments !== undefined
        ? { paidInstallments: dto.paidInstallments }
        : {}),
      ...(dto.nextDueDate ? { nextDueDate: new Date(dto.nextDueDate) } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.currency ? { currency: dto.currency } : {}),
      ...(dto.interestRate !== undefined
        ? { interestRate: dto.interestRate }
        : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    });
    if (!updated) {
      throw new NotFoundException('Loan not found');
    }
    await this.syncInstallments.execute(updated, now);
    return mapLoan(updated);
  }

  async deactivateLoan(userId: string, id: string) {
    const updated = await this.repo.updateLoan(userId, id, { isActive: false });
    if (!updated) {
      throw new NotFoundException('Loan not found');
    }
    return { success: true };
  }

  async deleteLoan(userId: string, id: string) {
    const result = await this.repo.deleteLoan(userId, id);
    if (result.count === 0) {
      throw new NotFoundException('Loan not found');
    }
    return { success: true };
  }

  async restoreLoan(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreLoan(userId, id, now);
    assertRestored(restored, 'Loan not found');
    return { success: true };
  }

  async listReceivables(userId: string) {
    const rows = await this.repo.listReceivables(userId);
    return rows.map(mapReceivable);
  }

  async getReceivable(userId: string, id: string) {
    const row = await this.repo.findReceivable(userId, id);
    if (!row) {
      throw new NotFoundException('Receivable not found');
    }
    return mapReceivable(row);
  }

  async createReceivable(userId: string, dto: CreateReceivableDto) {
    const markedAsPaid = dto.status === 'PAID' && dto.paidAmount === undefined;
    const created = await this.repo.createReceivable(
      userId,
      {
        debtorName: dto.debtorName,
        description: dto.description,
        amount: dto.amount,
        currency: dto.currency ?? 'DOP',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
      markedAsPaid ? dto.amount : (dto.paidAmount ?? 0),
      dto.status,
    );
    return mapReceivable(created);
  }

  async updateReceivable(userId: string, id: string, dto: UpdateReceivableDto) {
    await this.assertReceivableOwned(userId, id);
    await this.repo.updateReceivable(
      userId,
      id,
      {
        ...(dto.debtorName ? { debtorName: dto.debtorName } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.currency ? { currency: dto.currency } : {}),
        ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}),
      },
      dto.status,
    );
    const saved = await this.repo.findReceivable(userId, id);
    if (!saved) {
      throw new NotFoundException('Receivable not found');
    }
    return mapReceivable(saved);
  }

  async listReceivablePayments(userId: string, id: string) {
    await this.assertReceivableOwned(userId, id);
    const rows = await this.repo.listReceivablePayments(id);
    return rows.map(mapReceivablePayment);
  }

  private async assertReceivableOwned(
    userId: string,
    id: string,
  ): Promise<void> {
    const receivable = await this.repo.findReceivable(userId, id);
    if (!receivable) {
      throw new NotFoundException('Receivable not found');
    }
  }

  async deleteReceivable(userId: string, id: string) {
    const result = await this.repo.deleteReceivable(userId, id);
    if (result.count === 0) {
      throw new NotFoundException('Receivable not found');
    }
    return { success: true };
  }

  async restoreReceivable(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreReceivable(userId, id, now);
    assertRestored(restored, 'Receivable not found');
    return { success: true };
  }
}
