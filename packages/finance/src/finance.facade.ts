import { Injectable } from '@nestjs/common';
import { DEFAULT_PAGE_LIMIT } from '@personal-os/core';
import { AnalyticsService } from './analytics/application/analytics.service';
import { CatalogService } from './catalog/application/catalog.service';
import { IngestionService } from './ingestion/application/ingestion.service';
import type {
  CreateCardPaymentCommand,
  CreateTransactionCommand,
  CreateTransferCommand,
  ListTransactionsQuery,
  UpdateTransactionCommand,
} from './ledger/application/commands/ledger.commands';
import { ConfirmTransactionUseCase } from './ledger/application/confirm-transaction.use-case';
import { AdjustBalanceUseCase } from './ledger/application/adjust-balance.use-case';
import type { AdjustBalanceCommand } from './ledger/application/adjust-balance.use-case';
import { CreateCardPaymentUseCase } from './ledger/application/create-card-payment.use-case';
import { CreateTransactionUseCase } from './ledger/application/create-transaction.use-case';
import { CreateTransferUseCase } from './ledger/application/create-transfer.use-case';
import { LedgerQueryService } from './ledger/application/ledger-query.service';
import { ReverseTransactionUseCase } from './ledger/application/reverse-transaction.use-case';
import { UpdateTransactionUseCase } from './ledger/application/update-transaction.use-case';
import { UnconfirmTransactionUseCase } from './ledger/application/unconfirm-transaction.use-case';
import { PlanningService } from './planning/application/planning.service';
import { ApplyLoanPrepaymentUseCase } from './planning/application/apply-loan-prepayment.use-case';
import { PayNextLoanInstallmentUseCase } from './planning/application/pay-next-loan-installment.use-case';
import { AllocateToGoalUseCase } from './planning/application/allocate-to-goal.use-case';
import { RecordReceivablePaymentUseCase } from './planning/application/record-receivable-payment.use-case';
import type { LoanPrepaymentCommand } from './planning/application/apply-loan-prepayment.use-case';
import type { PayInstallmentCommand } from './planning/application/pay-next-loan-installment.use-case';
import { CardStatementsService } from './statements/application/card-statements.service';
import {
  LinkTransactionUseCase,
  type LinkTransactionCommand,
} from './planning/application/link-transaction.use-case';
import { UnlinkTransactionUseCase } from './planning/application/unlink-transaction.use-case';
import type { AssignEmailMessageDto } from './ingestion/presentation/dto/oauth-callback-query.dto';
import type { CreateBudgetDto } from './planning/presentation/dto/create-budget.dto';
import type { CreateSavingsGoalDto } from './planning/presentation/dto/create-savings-goal.dto';
import type { CreateSavingsGoalAllocationDto } from './planning/presentation/dto/create-savings-goal-allocation.dto';
import type { CreateReceivablePaymentDto } from './planning/presentation/dto/create-receivable-payment.dto';
import type { UpdateBudgetDto } from './planning/presentation/dto/update-budget.dto';
import type { UpdateLoanDto } from './planning/presentation/dto/update-loan.dto';
import type { UpdateSavingsGoalDto } from './planning/presentation/dto/update-savings-goal.dto';
import { WipeFinanceUserDataUseCase } from './shared/application/wipe-finance-user-data.use-case';
import type { FinanceWipeLayer } from './shared/domain/finance-wipe-layers';

/**
 * Stable public API for AI tools and external modules.
 * Root composition only — no god service underneath.
 */
@Injectable()
export class FinanceFacade {
  constructor(
    private readonly ledgerQueries: LedgerQueryService,
    private readonly createTx: CreateTransactionUseCase,
    private readonly updateTx: UpdateTransactionUseCase,
    private readonly confirmTx: ConfirmTransactionUseCase,
    private readonly adjustBalanceTx: AdjustBalanceUseCase,
    private readonly unconfirmTx: UnconfirmTransactionUseCase,
    private readonly reverseTx: ReverseTransactionUseCase,
    private readonly createTransfer: CreateTransferUseCase,
    private readonly createCardPaymentTx: CreateCardPaymentUseCase,
    private readonly catalog: CatalogService,
    private readonly planning: PlanningService,
    private readonly payLoanInstallment: PayNextLoanInstallmentUseCase,
    private readonly prepayLoanTx: ApplyLoanPrepaymentUseCase,
    private readonly allocateToGoal: AllocateToGoalUseCase,
    private readonly recordReceivable: RecordReceivablePaymentUseCase,
    private readonly analytics: AnalyticsService,
    private readonly statements: CardStatementsService,
    private readonly ingestion: IngestionService,
    private readonly linkTx: LinkTransactionUseCase,
    private readonly unlinkTx: UnlinkTransactionUseCase,
    private readonly wipeFinance: WipeFinanceUserDataUseCase,
  ) {}

  listAccounts(userId: string) {
    return this.catalog.listAccounts(userId);
  }

  listCards(userId: string) {
    return this.catalog.listCards(userId);
  }

  getAnalyticsSummary(userId: string, dateFrom?: string, dateTo?: string) {
    return this.analytics.getAnalyticsSummary(userId, dateFrom, dateTo);
  }

  getSpendingOverTime(
    userId: string,
    dateFrom?: string,
    dateTo?: string,
    groupBy?: 'day' | 'week' | 'month',
  ) {
    return this.analytics.getSpendingOverTime(
      userId,
      dateFrom,
      dateTo,
      groupBy ?? 'day',
    );
  }

  listTransactions(userId: string, query: ListTransactionsQuery) {
    return this.ledgerQueries.listTransactions(userId, query);
  }

  getTransaction(userId: string, id: string) {
    return this.ledgerQueries.getTransaction(userId, id);
  }

  listPossibleDuplicates(userId: string) {
    return this.ledgerQueries.listTransactions(userId, {
      possibleDuplicates: true,
      limit: 50,
    });
  }

  createTransaction(
    userId: string,
    command: CreateTransactionCommand,
    source: 'MANUAL' | 'AI' = 'MANUAL',
  ) {
    return this.createTx.execute(userId, command, source);
  }

  updateTransaction(
    userId: string,
    id: string,
    command: UpdateTransactionCommand,
  ) {
    return this.updateTx.execute(userId, id, command);
  }

  confirmTransaction(userId: string, id: string) {
    return this.confirmTx.execute(userId, id);
  }

  adjustBalance(userId: string, command: AdjustBalanceCommand) {
    return this.adjustBalanceTx.execute(userId, command);
  }

  linkTransaction(
    userId: string,
    transactionId: string,
    command: LinkTransactionCommand,
  ) {
    return this.linkTx.execute(userId, transactionId, command, new Date());
  }

  unlinkTransaction(userId: string, transactionId: string) {
    return this.unlinkTx.execute(userId, transactionId, new Date());
  }

  async listPendingEmails(userId: string) {
    const page = await this.ingestion.listPendingAssignment(userId, {
      limit: DEFAULT_PAGE_LIMIT,
    });
    return { items: page.items, hasMore: page.hasMore };
  }

  assignPendingEmail(
    userId: string,
    messageId: string,
    dto: AssignEmailMessageDto,
  ) {
    return this.ingestion.assignPendingMessage(userId, messageId, dto);
  }

  retryPendingEmail(userId: string, messageId: string) {
    return this.ingestion.retryPendingMessage(userId, messageId);
  }

  completePendingEmailAmount(
    userId: string,
    messageId: string,
    amount: number,
  ) {
    return this.ingestion.completePendingAmount(userId, messageId, amount);
  }

  unconfirmTransaction(userId: string, id: string) {
    return this.unconfirmTx.execute(userId, id);
  }

  reverseTransaction(userId: string, id: string, aiMetadata?: unknown) {
    return this.reverseTx.execute(userId, id, aiMetadata);
  }

  createTransferTransaction(userId: string, command: CreateTransferCommand) {
    return this.createTransfer.execute(userId, command);
  }

  createCardPayment(userId: string, command: CreateCardPaymentCommand) {
    return this.createCardPaymentTx.execute(userId, command);
  }

  async getCardStatements(userId: string, cardId: string) {
    const page = await this.statements.listCardStatements(
      userId,
      cardId,
      { limit: 20 },
      new Date(),
    );
    return page.items;
  }

  getCardStatement(userId: string, cardId: string, statementId: string) {
    return this.statements.getStatementDetail(
      userId,
      cardId,
      statementId,
      new Date(),
    );
  }

  getBudgetStatus(userId: string) {
    return this.analytics.getBudgetStatus(userId);
  }

  payNextLoanInstallment(
    userId: string,
    loanId: string,
    command: PayInstallmentCommand = {},
  ) {
    return this.payLoanInstallment.execute(userId, loanId, new Date(), command);
  }

  prepayLoan(userId: string, loanId: string, command: LoanPrepaymentCommand) {
    return this.prepayLoanTx.execute(userId, loanId, new Date(), command);
  }

  getLoanSchedule(userId: string, loanId: string) {
    return this.planning.listLoanInstallments(userId, loanId);
  }

  listBudgets(userId: string) {
    return this.planning.listBudgets(userId);
  }

  createBudget(userId: string, dto: CreateBudgetDto) {
    return this.planning.createBudget(userId, dto);
  }

  updateBudget(userId: string, id: string, dto: UpdateBudgetDto) {
    return this.planning.updateBudget(userId, id, dto);
  }

  listSavingsGoals(userId: string) {
    return this.planning.listSavingsGoals(userId);
  }

  createSavingsGoal(userId: string, dto: CreateSavingsGoalDto) {
    return this.planning.createSavingsGoal(userId, dto, new Date());
  }

  updateSavingsGoal(userId: string, id: string, dto: UpdateSavingsGoalDto) {
    return this.planning.updateSavingsGoal(userId, id, dto, new Date());
  }

  recordSavingsGoalContribution(
    userId: string,
    goalId: string,
    dto: CreateSavingsGoalAllocationDto,
  ) {
    return this.allocateToGoal.execute(userId, goalId, dto, new Date());
  }

  recordReceivablePayment(
    userId: string,
    receivableId: string,
    dto: CreateReceivablePaymentDto,
  ) {
    return this.recordReceivable.execute(userId, receivableId, dto, new Date());
  }

  listLoans(userId: string) {
    return this.planning.listLoans(userId);
  }

  updateLoan(userId: string, id: string, dto: UpdateLoanDto) {
    return this.planning.updateLoan(userId, id, dto, new Date());
  }

  listCategories(userId: string, type?: 'EXPENSE' | 'INCOME') {
    return this.catalog.listCategories(userId, type);
  }

  listEmailSources(userId: string) {
    return this.ingestion.listEmailSources(userId);
  }

  triggerEmailSync(userId: string, sourceId: string, forceFullSync = false) {
    return this.ingestion.triggerEmailSync(userId, sourceId, forceFullSync);
  }

  getSpendingByCategory(userId: string, dateFrom?: string, dateTo?: string) {
    return this.analytics.getSpendingByCategory(userId, dateFrom, dateTo);
  }

  wipeUserData(
    userId: string,
    layers: readonly FinanceWipeLayer[],
    options?: { balanceInstitutionId?: string },
  ) {
    return this.wipeFinance.execute(userId, layers, options);
  }
}
