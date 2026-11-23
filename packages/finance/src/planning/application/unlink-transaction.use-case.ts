import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LEDGER_QUERY_REPOSITORY } from '../../shared/application/tokens';
import { roundMoney } from '../../shared/domain/money';
import {
  TRANSACTION_LINK_KIND,
  TRANSACTION_LINK_TARGET_NOT_FOUND,
  TRANSACTION_LINK_TARGET_NOT_FOUND_MESSAGE,
  TRANSACTION_NOT_LINKED,
  TRANSACTION_NOT_LINKED_MESSAGE,
} from '../../shared/domain/transaction-links';
import type { LedgerQueryRepositoryPort } from '../../ledger/application/ports/ledger-query.repository.port';
import { shiftLoanDueDate } from '../domain/loan-installment-schedule';
import { distributeLoanPayment } from '../domain/loan-payment';
import { PlanningLoanRepository } from '../infrastructure/planning-loan.repository';
import { PlanningReceivableRepository } from '../infrastructure/planning-receivable.repository';
import { PlanningSavingsGoalRepository } from '../infrastructure/planning-savings-goal.repository';

/**
 * Removes the planning link of a movement and undoes the effect it applied.
 * The movement itself is kept; only the instalment, collection or contribution
 * returns to its previous state.
 */
@Injectable()
export class UnlinkTransactionUseCase {
  constructor(
    @Inject(LEDGER_QUERY_REPOSITORY)
    private readonly ledger: LedgerQueryRepositoryPort,
    private readonly loans: PlanningLoanRepository,
    private readonly receivables: PlanningReceivableRepository,
    private readonly savingsGoals: PlanningSavingsGoalRepository,
  ) {}

  async execute(userId: string, transactionId: string, now: Date) {
    const kind = await this.ledger.findPlanningLinkKind(transactionId, userId);
    if (!kind) {
      throw new NotFoundException({
        code: TRANSACTION_NOT_LINKED,
        message: TRANSACTION_NOT_LINKED_MESSAGE,
      });
    }
    if (kind === TRANSACTION_LINK_KIND.LOAN_INSTALLMENT) {
      await this.unlinkInstallment(userId, transactionId);
      return { success: true };
    }
    if (kind === TRANSACTION_LINK_KIND.RECEIVABLE_PAYMENT) {
      await this.unlinkReceivable(userId, transactionId);
      return { success: true };
    }
    await this.unlinkContribution(userId, transactionId, now);
    return { success: true };
  }

  private async unlinkInstallment(userId: string, transactionId: string) {
    const installment = await this.loans.findInstallmentByTransactionId(
      userId,
      transactionId,
    );
    if (!installment) {
      throw new NotFoundException({
        code: TRANSACTION_LINK_TARGET_NOT_FOUND,
        message: TRANSACTION_LINK_TARGET_NOT_FOUND_MESSAGE,
      });
    }
    const breakdown = distributeLoanPayment({
      paid: Number(installment.paidAmount),
      lateFee: Number(installment.lateFee),
      fees: Number(installment.fees),
      insurance: Number(installment.insurance),
      interest: Number(installment.interest),
      principal: Number(installment.principal),
    });
    const loan = installment.loan;
    const fullyPaid = installment.paidAt !== null;
    await this.loans.applyInstallmentPayment(installment.id, {
      paidAmount: 0,
      status: 'PENDING',
      paidAt: null,
      transactionId: null,
    });
    await this.loans.updateLoan(userId, loan.id, {
      currentBalance: roundMoney(
        Number(loan.currentBalance) + breakdown.principal,
      ),
      ...(fullyPaid
        ? { paidInstallments: Math.max(0, loan.paidInstallments - 1) }
        : {}),
      ...(fullyPaid
        ? {
            nextDueDate: shiftLoanDueDate(
              loan.nextDueDate,
              loan.installmentFreq,
              -1,
            ),
          }
        : {}),
    });
  }

  private async unlinkReceivable(userId: string, transactionId: string) {
    const payment = await this.receivables.findReceivablePaymentByTransactionId(
      userId,
      transactionId,
    );
    if (!payment) {
      throw new NotFoundException({
        code: TRANSACTION_LINK_TARGET_NOT_FOUND,
        message: TRANSACTION_LINK_TARGET_NOT_FOUND_MESSAGE,
      });
    }
    await this.receivables.deleteReceivablePayment(
      payment.receivableId,
      payment.id,
    );
  }

  private async unlinkContribution(
    userId: string,
    transactionId: string,
    now: Date,
  ) {
    const contribution =
      await this.savingsGoals.findSavingsGoalContributionByTransactionId(
        userId,
        transactionId,
      );
    if (!contribution) {
      throw new NotFoundException({
        code: TRANSACTION_LINK_TARGET_NOT_FOUND,
        message: TRANSACTION_LINK_TARGET_NOT_FOUND_MESSAGE,
      });
    }
    await this.savingsGoals.removeSavingsGoalContribution(
      contribution.goalId,
      contribution.id,
      now,
    );
  }
}
