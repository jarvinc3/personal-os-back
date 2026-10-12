import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import { roundMoney } from '../../shared/domain/money';
import {
  LOAN_HAS_OVERDUE,
  LOAN_HAS_OVERDUE_MESSAGE,
  LOAN_NOT_FOUND,
  LOAN_NOT_FOUND_MESSAGE,
} from '../../shared/domain/loan';
import {
  buildFrenchSchedule,
  frenchInstallmentAmount,
  remainingInstallmentsFor,
  type LoanInstallmentFrequency,
} from '../domain/loan-installment-schedule';
import {
  LOAN_PREPAYMENT_MODE,
  type LoanPrepaymentMode,
} from '../domain/loan-payment';
import { PlanningRepository } from '../infrastructure/planning.repository';
import { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';

export type LoanPrepaymentCommand = {
  amount: number;
  accountId: string;
  mode: LoanPrepaymentMode;
  date?: string;
  penaltyAmount?: number;
};

type LoanForPrepayment = {
  id: string;
  currency: string;
  lenderName: string;
  originalAmount: { toString(): string } | number;
  currentBalance: { toString(): string } | number;
  installmentAmount: { toString(): string } | number;
  installmentFreq: LoanInstallmentFrequency;
  totalInstallments: number;
  paidInstallments: number;
  nextDueDate: Date;
  interestRate: { toString(): string } | number | null;
  insuranceAmount: { toString(): string } | number | null;
  prepaymentPenaltyPct: { toString(): string } | number | null;
};

@Injectable()
export class ApplyLoanPrepaymentUseCase {
  constructor(
    private readonly repo: PlanningRepository,
    private readonly syncInstallments: SyncLoanInstallmentsUseCase,
    private readonly createTransaction: CreateTransactionUseCase,
  ) {}

  async execute(
    userId: string,
    loanId: string,
    now: Date,
    command: LoanPrepaymentCommand,
  ) {
    const loan = await this.requireLoan(userId, loanId);
    await this.syncInstallments.execute(loan, now);
    await this.assertNoOverdue(loanId, now);

    const penalty =
      command.penaltyAmount ??
      roundMoney(Number(loan.prepaymentPenaltyPct ?? 0) * command.amount);
    const paidAt = command.date ? new Date(command.date) : now;
    const categoryId = await this.repo.findLoanPaymentCategoryId();
    const movement = await this.createTransaction.execute(userId, {
      accountId: command.accountId,
      type: 'DEBIT',
      amount: roundMoney(command.amount + penalty),
      currency: loan.currency,
      transactionDate: paidAt.toISOString(),
      description: `Abono a capital: ${loan.lenderName}`,
      ...(categoryId ? { categoryId } : {}),
    });

    const prepayment = await this.repo.createLoanPrepayment({
      loanId,
      amount: command.amount,
      penalty,
      mode: command.mode,
      paidAt,
      transactionId: movement.id,
    });

    const updated = this.projectLoan(loan, command.amount, command.mode);
    await this.repo.updateLoan(userId, loanId, updated);
    await this.syncInstallments.execute({ ...loan, ...updated }, now);

    return prepayment;
  }

  async preview(
    userId: string,
    loanId: string,
    amount: number,
    mode: LoanPrepaymentMode,
  ) {
    const loan = await this.requireLoan(userId, loanId);
    const projected = this.projectLoan(loan, amount, mode);
    const schedule = buildFrenchSchedule({
      anchorDueDate: loan.nextDueDate,
      anchorInstallmentNo: loan.paidInstallments + 1,
      installmentFreq: loan.installmentFreq,
      totalInstallments: projected.totalInstallments,
      originalPrincipal: Number(loan.originalAmount),
      outstandingPrincipal: projected.currentBalance,
      annualInterestRate:
        loan.interestRate === null ? null : Number(loan.interestRate),
      installmentAmount: projected.installmentAmount,
      insuranceAmount:
        loan.insuranceAmount === null ? 0 : Number(loan.insuranceAmount),
    });
    const interest = schedule.reduce((sum, entry) => sum + entry.interest, 0);
    const last = schedule[schedule.length - 1];
    return {
      newBalance: projected.currentBalance,
      totalInstallments: projected.totalInstallments,
      installmentAmount: projected.installmentAmount,
      interestRemaining: roundMoney(interest),
      newEndDate: last ? last.dueDate : loan.nextDueDate,
    };
  }

  private async requireLoan(userId: string, loanId: string) {
    const loan = await this.repo.findLoan(userId, loanId);
    if (!loan) {
      throw new NotFoundException({
        code: LOAN_NOT_FOUND,
        message: LOAN_NOT_FOUND_MESSAGE,
      });
    }
    return loan;
  }

  private async assertNoOverdue(loanId: string, now: Date): Promise<void> {
    const installments = await this.repo.listInstallments(loanId);
    const hasOverdue = installments.some(
      (installment) =>
        installment.paidAt === null &&
        installment.dueDate.getTime() < now.getTime(),
    );
    if (hasOverdue) {
      throw new ConflictException({
        code: LOAN_HAS_OVERDUE,
        message: LOAN_HAS_OVERDUE_MESSAGE,
      });
    }
  }

  private projectLoan(
    loan: LoanForPrepayment,
    amount: number,
    mode: LoanPrepaymentMode,
  ): {
    currentBalance: number;
    totalInstallments: number;
    installmentAmount: number;
  } {
    const currentBalance = roundMoney(Number(loan.currentBalance) - amount);
    const remaining = Math.max(
      1,
      loan.totalInstallments - loan.paidInstallments,
    );
    const annualInterestRate =
      loan.interestRate === null ? null : Number(loan.interestRate);
    if (mode === LOAN_PREPAYMENT_MODE.REDUCE_INSTALLMENT) {
      return {
        currentBalance,
        totalInstallments: loan.totalInstallments,
        installmentAmount: frenchInstallmentAmount({
          principal: currentBalance,
          annualInterestRate,
          installmentFreq: loan.installmentFreq,
          totalInstallments: remaining,
        }),
      };
    }
    const term = remainingInstallmentsFor({
      balance: currentBalance,
      installmentAmount: Number(loan.installmentAmount),
      annualInterestRate,
      installmentFreq: loan.installmentFreq,
    });
    return {
      currentBalance,
      totalInstallments: loan.paidInstallments + term,
      installmentAmount: Number(loan.installmentAmount),
    };
  }
}
