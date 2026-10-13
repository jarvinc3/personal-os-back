import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import { roundMoney } from '../../shared/domain/money';
import {
  LOAN_ACCOUNT_REQUIRED,
  LOAN_ACCOUNT_REQUIRED_MESSAGE,
  LOAN_NOT_FOUND,
  LOAN_NOT_FOUND_MESSAGE,
  PAYMENT_EXCEEDS_INSTALLMENT,
  PAYMENT_EXCEEDS_INSTALLMENT_MESSAGE,
} from '../../shared/domain/loan';
import { shiftLoanDueDate } from '../domain/loan-installment-schedule';
import {
  distributeLoanPayment,
  installmentDueTotal,
} from '../domain/loan-payment';
import { PlanningRepository } from '../infrastructure/planning.repository';
import { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';

export type PayInstallmentCommand = {
  amount?: number;
  accountId?: string;
  excessAsPrepayment?: boolean;
};

/**
 * Pays the oldest unpaid instalment: records the movement, splits the payment
 * over the instalment and lowers the balance only by the paid principal.
 */
@Injectable()
export class PayNextLoanInstallmentUseCase {
  constructor(
    private readonly repo: PlanningRepository,
    private readonly syncInstallments: SyncLoanInstallmentsUseCase,
    private readonly createTransaction: CreateTransactionUseCase,
  ) {}

  async execute(
    userId: string,
    loanId: string,
    now: Date,
    command: PayInstallmentCommand = {},
  ) {
    const loan = await this.repo.findLoan(userId, loanId);
    if (!loan) {
      throw new NotFoundException({
        code: LOAN_NOT_FOUND,
        message: LOAN_NOT_FOUND_MESSAGE,
      });
    }

    await this.syncInstallments.execute(loan, now);
    const installment = await this.repo.findNextUnpaidInstallment(loanId);
    if (!installment) {
      throw new BadRequestException('Loan has no pending instalment');
    }

    const dueTotal = installmentDueTotal({
      principal: Number(installment.principal),
      interest: Number(installment.interest),
      insurance: Number(installment.insurance),
      fees: Number(installment.fees),
      lateFee: Number(installment.lateFee),
    });
    const requested = command.amount ?? dueTotal;
    const excess = roundMoney(requested - dueTotal);
    if (excess > 0 && !command.excessAsPrepayment) {
      throw new BadRequestException({
        code: PAYMENT_EXCEEDS_INSTALLMENT,
        message: PAYMENT_EXCEEDS_INSTALLMENT_MESSAGE,
      });
    }
    const paid = Math.min(requested, dueTotal);
    const breakdown = distributeLoanPayment({
      paid,
      lateFee: Number(installment.lateFee),
      fees: Number(installment.fees),
      insurance: Number(installment.insurance),
      interest: Number(installment.interest),
      principal: Number(installment.principal),
    });

    const accountId = command.accountId ?? loan.accountId;
    if (!accountId) {
      throw new BadRequestException({
        code: LOAN_ACCOUNT_REQUIRED,
        message: LOAN_ACCOUNT_REQUIRED_MESSAGE,
      });
    }
    const categoryId = await this.repo.findLoanPaymentCategoryId();
    const movement = await this.createTransaction.execute(userId, {
      accountId,
      type: 'DEBIT',
      amount: requested,
      currency: loan.currency,
      transactionDate: now.toISOString(),
      description: `Cuota ${installment.installmentNo}: ${loan.lenderName}`,
      ...(categoryId ? { categoryId } : {}),
    });
    const transactionId = movement.id;

    const newPaidAmount = roundMoney(Number(installment.paidAmount) + paid);
    const fullyPaid = newPaidAmount >= Number(installment.amount) - 0.005;
    await this.repo.applyInstallmentPayment(installment.id, {
      paidAmount: newPaidAmount,
      status: fullyPaid ? 'PAID' : 'PARTIAL',
      paidAt: fullyPaid ? now : null,
      transactionId,
    });

    const excessPrincipal = excess > 0 ? excess : 0;
    const nextBalance = roundMoney(
      Number(loan.currentBalance) - breakdown.principal - excessPrincipal,
    );
    await this.repo.updateLoan(userId, loanId, {
      currentBalance: nextBalance,
      ...(fullyPaid ? { paidInstallments: loan.paidInstallments + 1 } : {}),
      ...(fullyPaid
        ? {
            nextDueDate: shiftLoanDueDate(
              loan.nextDueDate,
              loan.installmentFreq,
              1,
            ),
          }
        : {}),
    });
    if (excessPrincipal > 0) {
      await this.repo.createLoanPrepayment({
        loanId,
        amount: excessPrincipal,
        penalty: 0,
        mode: 'REDUCE_TERM',
        paidAt: now,
        transactionId: null,
      });
    }

    return {
      installmentNo: installment.installmentNo,
      breakdown,
      paidAmount: newPaidAmount,
      status: fullyPaid ? 'PAID' : 'PARTIAL',
      currentBalance: nextBalance,
    };
  }
}
