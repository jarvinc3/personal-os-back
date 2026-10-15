import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LEDGER_REPOSITORY } from '../../shared/application/tokens';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { roundMoney } from '../../shared/domain/money';
import {
  TRANSACTION_LINKED,
  TRANSACTION_LINK_AMOUNT_INVALID,
  TRANSACTION_LINK_AMOUNT_INVALID_MESSAGE,
  TRANSACTION_LINK_INVALID,
  TRANSACTION_LINK_INVALID_MESSAGE,
  TRANSACTION_LINK_KIND,
  TRANSACTION_LINK_TARGET_NOT_FOUND,
  TRANSACTION_LINK_TARGET_NOT_FOUND_MESSAGE,
  transactionLinkedMessage,
  type TransactionLinkKind,
} from '../../shared/domain/transaction-links';
import type {
  LedgerRepositoryPort,
  LedgerTransactionRow,
} from '../../ledger/application/ports/ledger.repository.port';
import { shiftLoanDueDate } from '../domain/loan-installment-schedule';
import {
  distributeLoanPayment,
  installmentDueTotal,
} from '../domain/loan-payment';
import { PlanningRepository } from '../infrastructure/planning.repository';
import { AllocateToGoalUseCase } from './allocate-to-goal.use-case';
import { RecordReceivablePaymentUseCase } from './record-receivable-payment.use-case';

export type LinkTransactionCommand =
  | { kind: 'LOAN_INSTALLMENT'; loanId: string; installmentId: string }
  | { kind: 'RECEIVABLE_PAYMENT'; receivableId: string }
  | { kind: 'SAVINGS_CONTRIBUTION'; goalId: string };

export type TransactionLinkDescriptor = {
  kind: TransactionLinkKind;
  targetId: string;
  label: string;
};

const CONFIRMED = 'CONFIRMED';

/**
 * Attaches an existing movement to a loan instalment, a receivable collection
 * or a savings goal. It never creates a new movement: the movement already
 * moved the money, this only records the planning effect.
 */
@Injectable()
export class LinkTransactionUseCase {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly ledger: LedgerRepositoryPort,
    private readonly planning: PlanningRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly recordPayment: RecordReceivablePaymentUseCase,
    private readonly allocateToGoal: AllocateToGoalUseCase,
  ) {}

  async execute(
    userId: string,
    transactionId: string,
    command: LinkTransactionCommand,
    now: Date,
  ): Promise<TransactionLinkDescriptor> {
    const movement = await this.ledger.findTransactionById(
      transactionId,
      userId,
    );
    if (!movement) {
      throw new NotFoundException('Transacción no encontrada');
    }
    if (movement.status !== CONFIRMED) {
      throw new ConflictException({
        code: TRANSACTION_LINK_INVALID,
        message: TRANSACTION_LINK_INVALID_MESSAGE,
      });
    }
    if (movement.transferGroupId) {
      throw new ConflictException({
        code: TRANSACTION_LINKED,
        message: transactionLinkedMessage(TRANSACTION_LINK_KIND.TRANSFER),
      });
    }
    const existingLink = await this.ledger.findPlanningLinkKind(
      transactionId,
      userId,
    );
    if (existingLink) {
      throw new ConflictException({
        code: TRANSACTION_LINKED,
        message: transactionLinkedMessage(existingLink),
      });
    }

    switch (command.kind) {
      case 'LOAN_INSTALLMENT':
        return this.linkInstallment(userId, movement, command, now);
      case 'RECEIVABLE_PAYMENT':
        return this.linkReceivable(userId, movement, command, now);
      case 'SAVINGS_CONTRIBUTION':
        return this.linkGoal(userId, movement, command, now);
    }
  }

  private async linkInstallment(
    userId: string,
    movement: LedgerTransactionRow,
    command: Extract<LinkTransactionCommand, { kind: 'LOAN_INSTALLMENT' }>,
    now: Date,
  ): Promise<TransactionLinkDescriptor> {
    if (movement.type !== 'DEBIT' || !movement.accountId) {
      throw new ConflictException({
        code: TRANSACTION_LINK_INVALID,
        message: TRANSACTION_LINK_INVALID_MESSAGE,
      });
    }
    const installment = await this.planning.findInstallmentForUser(
      userId,
      command.installmentId,
    );
    if (!installment || installment.loanId !== command.loanId) {
      throw new NotFoundException({
        code: TRANSACTION_LINK_TARGET_NOT_FOUND,
        message: TRANSACTION_LINK_TARGET_NOT_FOUND_MESSAGE,
      });
    }
    if (installment.transactionId || installment.paidAt) {
      throw new ConflictException({
        code: TRANSACTION_LINKED,
        message: transactionLinkedMessage(
          TRANSACTION_LINK_KIND.LOAN_INSTALLMENT,
        ),
      });
    }
    await this.ownership.assertAccountOwned(userId, movement.accountId);

    const loan = installment.loan;
    const movementCurrency = movement.ledgerCurrency ?? movement.currency;
    if (movementCurrency !== loan.currency) {
      throw new ConflictException({
        code: TRANSACTION_LINK_INVALID,
        message: TRANSACTION_LINK_INVALID_MESSAGE,
      });
    }
    const amount = roundMoney(Number(movement.ledgerAmount ?? movement.amount));
    const dueTotal = installmentDueTotal({
      principal: Number(installment.principal),
      interest: Number(installment.interest),
      insurance: Number(installment.insurance),
      fees: Number(installment.fees),
      lateFee: Number(installment.lateFee),
    });
    if (amount > dueTotal + 0.005) {
      throw new BadRequestException({
        code: TRANSACTION_LINK_AMOUNT_INVALID,
        message: TRANSACTION_LINK_AMOUNT_INVALID_MESSAGE,
      });
    }
    const breakdown = distributeLoanPayment({
      paid: amount,
      lateFee: Number(installment.lateFee),
      fees: Number(installment.fees),
      insurance: Number(installment.insurance),
      interest: Number(installment.interest),
      principal: Number(installment.principal),
    });
    const newPaidAmount = roundMoney(Number(installment.paidAmount) + amount);
    const fullyPaid = newPaidAmount >= Number(installment.amount) - 0.005;
    await this.planning.applyInstallmentPayment(installment.id, {
      paidAmount: newPaidAmount,
      status: fullyPaid ? 'PAID' : 'PARTIAL',
      paidAt: fullyPaid ? now : null,
      transactionId: movement.id,
    });
    await this.planning.updateLoan(userId, loan.id, {
      currentBalance: roundMoney(
        Number(loan.currentBalance) - breakdown.principal,
      ),
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

    return {
      kind: TRANSACTION_LINK_KIND.LOAN_INSTALLMENT,
      targetId: installment.id,
      label: `Cuota ${installment.installmentNo}: ${loan.lenderName}`,
    };
  }

  private async linkReceivable(
    userId: string,
    movement: LedgerTransactionRow,
    command: Extract<LinkTransactionCommand, { kind: 'RECEIVABLE_PAYMENT' }>,
    now: Date,
  ): Promise<TransactionLinkDescriptor> {
    if (movement.type !== 'CREDIT' || !movement.accountId) {
      throw new ConflictException({
        code: TRANSACTION_LINK_INVALID,
        message: TRANSACTION_LINK_INVALID_MESSAGE,
      });
    }
    const receivable = await this.planning.findReceivable(
      userId,
      command.receivableId,
    );
    if (!receivable) {
      throw new NotFoundException({
        code: TRANSACTION_LINK_TARGET_NOT_FOUND,
        message: TRANSACTION_LINK_TARGET_NOT_FOUND_MESSAGE,
      });
    }
    const movementCurrency = movement.ledgerCurrency ?? movement.currency;
    const amount = roundMoney(Number(movement.ledgerAmount ?? movement.amount));
    const outstanding = roundMoney(
      Number(receivable.amount) - Number(receivable.paidAmount),
    );
    if (
      movementCurrency !== receivable.currency ||
      amount > outstanding + 0.005
    ) {
      throw new ConflictException({
        code: TRANSACTION_LINK_INVALID,
        message: TRANSACTION_LINK_INVALID_MESSAGE,
      });
    }
    await this.recordPayment.execute(
      userId,
      receivable.id,
      {
        amount,
        accountId: movement.accountId,
        paidAt: movement.transactionDate.toISOString(),
        transactionId: movement.id,
      },
      now,
    );
    return {
      kind: TRANSACTION_LINK_KIND.RECEIVABLE_PAYMENT,
      targetId: receivable.id,
      label: `Cobro: ${receivable.debtorName}`,
    };
  }

  private async linkGoal(
    userId: string,
    movement: LedgerTransactionRow,
    command: Extract<LinkTransactionCommand, { kind: 'SAVINGS_CONTRIBUTION' }>,
    now: Date,
  ): Promise<TransactionLinkDescriptor> {
    if (!movement.accountId) {
      throw new ConflictException({
        code: TRANSACTION_LINK_INVALID,
        message: TRANSACTION_LINK_INVALID_MESSAGE,
      });
    }
    const goal = await this.planning.findSavingsGoal(userId, command.goalId);
    if (!goal) {
      throw new NotFoundException({
        code: TRANSACTION_LINK_TARGET_NOT_FOUND,
        message: TRANSACTION_LINK_TARGET_NOT_FOUND_MESSAGE,
      });
    }
    if (goal.accountId && goal.accountId !== movement.accountId) {
      throw new ConflictException({
        code: TRANSACTION_LINK_INVALID,
        message: TRANSACTION_LINK_INVALID_MESSAGE,
      });
    }
    await this.allocateToGoal.execute(
      userId,
      goal.id,
      {
        amount: roundMoney(Number(movement.ledgerAmount ?? movement.amount)),
        kind: 'CONTRIBUTION',
        date: movement.transactionDate.toISOString(),
        transactionId: movement.id,
      },
      now,
    );
    return {
      kind: TRANSACTION_LINK_KIND.SAVINGS_CONTRIBUTION,
      targetId: goal.id,
      label: `Meta: ${goal.name}`,
    };
  }
}
