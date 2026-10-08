import { Injectable } from '@nestjs/common';
import { AnalyticsService } from './analytics/application/analytics.service';
import { CatalogService } from './catalog/application/catalog.service';
import { IngestionService } from './ingestion/application/ingestion.service';
import type {
  CreateTransactionCommand,
  CreateTransferCommand,
  ListTransactionsQuery,
  UpdateTransactionCommand,
} from './ledger/application/commands/ledger.commands';
import { ConfirmTransactionUseCase } from './ledger/application/confirm-transaction.use-case';
import { CreateTransactionUseCase } from './ledger/application/create-transaction.use-case';
import { CreateTransferUseCase } from './ledger/application/create-transfer.use-case';
import { LedgerQueryService } from './ledger/application/ledger-query.service';
import { ReverseTransactionUseCase } from './ledger/application/reverse-transaction.use-case';
import { UpdateTransactionUseCase } from './ledger/application/update-transaction.use-case';
import { PlanningService } from './planning/application/planning.service';
import type { CreateBudgetDto } from './planning/presentation/dto/create-budget.dto';
import type { CreateSavingsGoalDto } from './planning/presentation/dto/create-savings-goal.dto';
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
    private readonly reverseTx: ReverseTransactionUseCase,
    private readonly createTransfer: CreateTransferUseCase,
    private readonly catalog: CatalogService,
    private readonly planning: PlanningService,
    private readonly analytics: AnalyticsService,
    private readonly ingestion: IngestionService,
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

  reverseTransaction(userId: string, id: string, aiMetadata?: unknown) {
    return this.reverseTx.execute(userId, id, aiMetadata);
  }

  createTransferTransaction(userId: string, command: CreateTransferCommand) {
    return this.createTransfer.execute(userId, command);
  }

  getBudgetStatus(userId: string) {
    return this.analytics.getBudgetStatus(userId);
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
    return this.planning.createSavingsGoal(userId, dto);
  }

  updateSavingsGoal(userId: string, id: string, dto: UpdateSavingsGoalDto) {
    return this.planning.updateSavingsGoal(userId, id, dto);
  }

  listLoans(userId: string) {
    return this.planning.listLoans(userId);
  }

  updateLoan(userId: string, id: string, dto: UpdateLoanDto) {
    return this.planning.updateLoan(userId, id, dto);
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

  wipeUserData(userId: string, layers: readonly FinanceWipeLayer[]) {
    return this.wipeFinance.execute(userId, layers);
  }
}
