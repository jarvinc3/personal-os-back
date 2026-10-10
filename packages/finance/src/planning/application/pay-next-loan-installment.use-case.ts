import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import { shiftLoanDueDate } from '../domain/loan-installment-schedule';
import { PlanningRepository } from '../infrastructure/planning.repository';
import { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';

/**
 * Pays the oldest unpaid instalment: records the movement on the linked
 * account, marks the instalment and moves the loan forward one period.
 */
@Injectable()
export class PayNextLoanInstallmentUseCase {
  constructor(
    private readonly repo: PlanningRepository,
    private readonly syncInstallments: SyncLoanInstallmentsUseCase,
    private readonly createTransaction: CreateTransactionUseCase,
  ) {}

  async execute(userId: string, loanId: string, now: Date): Promise<void> {
    const loan = await this.repo.findLoan(userId, loanId);
    if (!loan) {
      throw new NotFoundException('Loan not found');
    }

    await this.syncInstallments.execute(loan, now);
    const installment = await this.repo.findNextUnpaidInstallment(loanId);
    if (!installment) {
      throw new BadRequestException('Loan has no pending instalment');
    }

    let transactionId: string | null = null;
    if (loan.accountId) {
      const movement = await this.createTransaction.execute(userId, {
        accountId: loan.accountId,
        type: 'DEBIT',
        amount: Number(installment.amount),
        currency: loan.currency,
        transactionDate: now.toISOString(),
        description: `Cuota ${installment.installmentNo}: ${loan.lenderName}`,
      });
      transactionId = movement.id;
    }

    await this.repo.markInstallmentPaid(installment.id, now, transactionId);
    await this.repo.updateLoan(userId, loanId, {
      paidInstallments: loan.paidInstallments + 1,
      currentBalance:
        Number(loan.currentBalance) - Number(loan.installmentAmount),
      nextDueDate: shiftLoanDueDate(loan.nextDueDate, loan.installmentFreq, 1),
    });
  }
}
