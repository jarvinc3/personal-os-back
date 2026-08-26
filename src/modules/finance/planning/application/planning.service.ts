import { Injectable, NotFoundException } from '@nestjs/common';
import { PlanningRepository } from '../infrastructure/planning.repository';
import type { CreateBudgetDto } from '../presentation/dto/create-budget.dto';
import type { CreateLoanDto } from '../presentation/dto/create-loan.dto';
import type { CreateReceivableDto } from '../presentation/dto/create-receivable.dto';
import type { CreateSavingsGoalDto } from '../presentation/dto/create-savings-goal.dto';
import type { UpdateBudgetDto } from '../presentation/dto/update-budget.dto';
import type { UpdateLoanDto } from '../presentation/dto/update-loan.dto';
import type { UpdateReceivableDto } from '../presentation/dto/update-receivable.dto';
import type { UpdateSavingsGoalDto } from '../presentation/dto/update-savings-goal.dto';
import { resolveReceivablePayment } from './resolve-receivable-payment';

@Injectable()
export class PlanningService {
  constructor(private readonly repo: PlanningRepository) {}

  listBudgets(userId: string) {
    return this.repo.listBudgets(userId);
  }

  createBudget(userId: string, dto: CreateBudgetDto) {
    return this.repo.createBudget(userId, {
      categoryId: dto.categoryId,
      periodType: dto.periodType,
      periodStart: new Date(dto.periodStart),
      periodEnd: new Date(dto.periodEnd),
      amountLimit: dto.amountLimit,
      amountSpent: 0,
      alertThresholdPct: dto.alertThresholdPct ?? 80,
    });
  }

  async updateBudget(userId: string, id: string, dto: UpdateBudgetDto) {
    const updated = await this.repo.updateBudget(userId, id, {
      ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
      ...(dto.periodType ? { periodType: dto.periodType } : {}),
      ...(dto.periodStart ? { periodStart: new Date(dto.periodStart) } : {}),
      ...(dto.periodEnd ? { periodEnd: new Date(dto.periodEnd) } : {}),
      ...(dto.amountLimit !== undefined ? { amountLimit: dto.amountLimit } : {}),
      ...(dto.alertThresholdPct !== undefined
        ? { alertThresholdPct: dto.alertThresholdPct }
        : {}),
    });
    if (!updated) throw new NotFoundException('Budget not found');
    return updated;
  }

  async deleteBudget(userId: string, id: string) {
    const result = await this.repo.deleteBudget(userId, id);
    if (result.count === 0) throw new NotFoundException('Budget not found');
    return { success: true };
  }

  listSavingsGoals(userId: string) {
    return this.repo.listSavingsGoals(userId);
  }

  createSavingsGoal(userId: string, dto: CreateSavingsGoalDto) {
    const current = dto.currentAmount ?? 0;
    const target = dto.targetAmount;
    const isCompleted = current >= target;
    return this.repo.createSavingsGoal(userId, {
      name: dto.name,
      description: dto.description,
      targetAmount: target,
      currentAmount: current,
      currency: dto.currency ?? 'DOP',
      targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
      isCompleted,
      completedAt: isCompleted ? new Date() : null,
    });
  }

  async updateSavingsGoal(
    userId: string,
    id: string,
    dto: UpdateSavingsGoalDto,
  ) {
    const existing = await this.repo.findSavingsGoal(userId, id);
    if (!existing) throw new NotFoundException('Savings goal not found');

    const nextCurrent =
      dto.currentAmount !== undefined
        ? dto.currentAmount
        : Number(existing.currentAmount);
    const nextTarget =
      dto.targetAmount !== undefined
        ? dto.targetAmount
        : Number(existing.targetAmount);
    const isCompleted = nextCurrent >= nextTarget;

    const updated = await this.repo.updateSavingsGoal(userId, id, {
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.currentAmount !== undefined
        ? { currentAmount: dto.currentAmount }
        : {}),
      ...(dto.targetAmount !== undefined
        ? { targetAmount: dto.targetAmount }
        : {}),
      ...(dto.currency ? { currency: dto.currency } : {}),
      ...(dto.targetDate ? { targetDate: new Date(dto.targetDate) } : {}),
      isCompleted,
      completedAt: isCompleted ? (existing.completedAt ?? new Date()) : null,
    });
    if (!updated) throw new NotFoundException('Savings goal not found');
    return updated;
  }

  async deleteSavingsGoal(userId: string, id: string) {
    const result = await this.repo.deleteSavingsGoal(userId, id);
    if (result.count === 0) throw new NotFoundException('Savings goal not found');
    return { success: true };
  }

  listLoans(userId: string) {
    return this.repo.listLoans(userId);
  }

  createLoan(userId: string, dto: CreateLoanDto) {
    return this.repo.createLoan(userId, {
      lenderName: dto.lenderName,
      accountId: dto.accountId,
      originalAmount: dto.originalAmount,
      currentBalance: dto.currentBalance,
      installmentAmount: dto.installmentAmount,
      installmentFreq: dto.installmentFreq,
      totalInstallments: dto.totalInstallments,
      paidInstallments: dto.paidInstallments ?? 0,
      nextDueDate: new Date(dto.nextDueDate),
    });
  }

  async updateLoan(userId: string, id: string, dto: UpdateLoanDto) {
    const updated = await this.repo.updateLoan(userId, id, {
      ...(dto.lenderName ? { lenderName: dto.lenderName } : {}),
      ...(dto.currentBalance !== undefined
        ? { currentBalance: dto.currentBalance }
        : {}),
      ...(dto.installmentAmount !== undefined
        ? { installmentAmount: dto.installmentAmount }
        : {}),
      ...(dto.installmentFreq
        ? { installmentFreq: dto.installmentFreq }
        : {}),
      ...(dto.totalInstallments !== undefined
        ? { totalInstallments: dto.totalInstallments }
        : {}),
      ...(dto.paidInstallments !== undefined
        ? { paidInstallments: dto.paidInstallments }
        : {}),
      ...(dto.nextDueDate ? { nextDueDate: new Date(dto.nextDueDate) } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });
    if (!updated) throw new NotFoundException('Loan not found');
    return updated;
  }

  async deactivateLoan(userId: string, id: string) {
    const updated = await this.repo.updateLoan(userId, id, { isActive: false });
    if (!updated) throw new NotFoundException('Loan not found');
    return { success: true };
  }

  listReceivables(userId: string) {
    return this.repo.listReceivables(userId);
  }

  createReceivable(userId: string, dto: CreateReceivableDto) {
    let paidAmount = dto.paidAmount ?? 0;
    if (dto.status === 'PAID' && dto.paidAmount === undefined) {
      paidAmount = dto.amount;
    }
    const payment = resolveReceivablePayment({
      amount: dto.amount,
      paidAmount,
      status: dto.status,
    });
    return this.repo.createReceivable(userId, {
      debtorName: dto.debtorName,
      description: dto.description,
      amount: dto.amount,
      paidAmount: payment.paidAmount,
      currency: dto.currency ?? 'DOP',
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      status: payment.status,
    });
  }

  async updateReceivable(
    userId: string,
    id: string,
    dto: UpdateReceivableDto,
  ) {
    const existing = await this.repo.findReceivable(userId, id);
    if (!existing) throw new NotFoundException('Receivable not found');

    const paymentTouched =
      dto.status !== undefined ||
      dto.paidAmount !== undefined ||
      dto.amount !== undefined;

    let payment: ReturnType<typeof resolveReceivablePayment> | undefined;
    if (paymentTouched) {
      const nextAmount =
        dto.amount !== undefined ? dto.amount : Number(existing.amount);
      let nextPaid =
        dto.paidAmount !== undefined
          ? dto.paidAmount
          : Number(existing.paidAmount);
      if (dto.status === 'PAID' && dto.paidAmount === undefined) {
        nextPaid = nextAmount;
      }
      payment = resolveReceivablePayment({
        amount: nextAmount,
        paidAmount: nextPaid,
        status: dto.status,
      });
    }

    const updated = await this.repo.updateReceivable(userId, id, {
      ...(dto.debtorName ? { debtorName: dto.debtorName } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(payment
        ? { paidAmount: payment.paidAmount, status: payment.status }
        : {}),
      ...(dto.currency ? { currency: dto.currency } : {}),
      ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}),
    });
    if (!updated) throw new NotFoundException('Receivable not found');
    return updated;
  }
}
