import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import * as jwt from 'jsonwebtoken';
import type { Env } from '../../config';
import { TransactionCreatedEvent } from '../../core/events/domain-events';
import { AppEvents } from '../../core/events/event.constants';
import { paginate } from '../../core/pagination/pagination.dto';
import type { GmailSyncJob } from '../../core/queues/queue-jobs';
import { QueueNames } from '../../core/queues/queue.constants';
import type { Prisma } from '../../prisma/generated/client';
import { normalizeLegacyCategoryIcon } from './constants/category-emoji.constants';
import type { ConnectEmailSourceDto } from './dto/connect-email-source.dto';
import type { CreateAccountDto } from './dto/create-account.dto';
import type { CreateBudgetDto } from './dto/create-budget.dto';
import type { CreateCardDto } from './dto/create-card.dto';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { CreateInstitutionDto } from './dto/create-institution.dto';
import type { CreateLoanDto } from './dto/create-loan.dto';
import type { CreateReceivableDto } from './dto/create-receivable.dto';
import type { CreateSavingsGoalDto } from './dto/create-savings-goal.dto';
import type { CreateTransactionDto } from './dto/create-transaction.dto';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import type { GoogleOAuthUrlQueryDto } from './dto/oauth-callback-query.dto';
import type { UpdateAccountDto } from './dto/update-account.dto';
import type { UpdateBudgetDto } from './dto/update-budget.dto';
import type { UpdateCardBalanceDto } from './dto/update-card-balance.dto';
import type { UpdateCardDto } from './dto/update-card.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';
import type { UpdateEmailSourceDto } from './dto/update-email-source.dto';
import type { UpdateInstitutionDto } from './dto/update-institution.dto';
import type { UpdateLoanDto } from './dto/update-loan.dto';
import type { UpdateReceivableDto } from './dto/update-receivable.dto';
import type { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto';
import { FinanceRepository } from './finance.repository';
import {
  exchangeGoogleAuthCode,
  fetchGoogleUserEmail,
  refreshGoogleAccessToken,
} from './utils/gmail-api.util';
import { decryptToken, encryptToken } from './utils/token-encryption.util';

function decimalToString(value: { toString(): string }) {
  return value.toString();
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly financeRepo: FinanceRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService<Env, true>,
    @Optional()
    @InjectQueue(QueueNames.GMAIL_SYNC)
    private readonly gmailSyncQueue?: Queue<GmailSyncJob>,
  ) { }

  private mapAccount(account: {
    id: string;
    name: string;
    type: string;
    institution: string | null;
    institutionId: string | null;
    currency: string;
    balance: { toString(): string };
    creditLimit: { toString(): string } | null;
    color: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    institutionRef?: { name: string } | null;
  }) {
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      institution: account.institutionRef?.name ?? account.institution,
      institutionId: account.institutionId,
      currency: account.currency,
      balance: decimalToString(account.balance),
      creditLimit: account.creditLimit ? decimalToString(account.creditLimit) : null,
      color: account.color,
      isActive: account.isActive,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  private mapTransaction(
    tx: NonNullable<Awaited<ReturnType<FinanceRepository['findTransactionById']>>>,
  ) {
    return {
      id: tx.id,
      accountId: tx.accountId,
      accountName: tx.account?.name ?? null,
      cardId: tx.cardId,
      cardName: tx.card?.name ?? null,
      type: tx.type,
      amount: decimalToString(tx.amount),
      amountBaseCurrency: decimalToString(tx.amountBaseCurrency),
      currency: tx.currency,
      merchant: tx.merchant,
      description: tx.description,
      transactionDate: tx.transactionDate.toISOString().slice(0, 10),
      status: tx.status,
      source: tx.source,
      categoryId: tx.categoryId,
      createdAt: tx.createdAt.toISOString(),
    };
  }

  private mapInstitution(institution: Awaited<ReturnType<FinanceRepository['listInstitutions']>>[number]) {
    return {
      id: institution.id,
      name: institution.name,
      color: institution.color,
      logoUrl: institution.logoUrl,
      country: institution.country,
      isActive: institution.isActive,
    };
  }

  private mapCard(card: Awaited<ReturnType<FinanceRepository['listCards']>>[number]) {
    return {
      id: card.id,
      institutionId: card.institutionId,
      institutionName: card.institution.name,
      accountId: card.accountId,
      accountName: card.account?.name ?? null,
      name: card.name,
      type: card.type,
      network: card.network,
      lastFour: card.lastFour,
      statementClosingDay: card.statementClosingDay,
      paymentDueDay: card.paymentDueDay,
      color: card.color,
      isActive: card.isActive,
      balances: card.balances.map((b) => ({
        id: b.id,
        currency: b.currency,
        balance: decimalToString(b.balance),
        creditLimit: b.creditLimit ? decimalToString(b.creditLimit) : null,
      })),
    };
  }

  async listAccounts(userId: string) {
    const accounts = await this.financeRepo.findAccountsByUser(userId);
    return accounts.map((account) => this.mapAccount(account));
  }

  async getAccount(userId: string, id: string) {
    const account = await this.financeRepo.findAccountById(id, userId);
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return this.mapAccount(account);
  }

  async createAccount(userId: string, dto: CreateAccountDto) {
    const account = await this.financeRepo.createAccount(userId, dto);
    return this.mapAccount(account);
  }

  async updateAccount(userId: string, id: string, dto: UpdateAccountDto) {
    await this.getAccount(userId, id);
    const account = await this.financeRepo.updateAccount(id, userId, dto);
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return this.mapAccount(account);
  }

  async listTransactions(userId: string, query: ListTransactionsQueryDto) {
    const [items, total] = await this.financeRepo.findTransactions(userId, query);
    return paginate(
      items.map((item) => this.mapTransaction(item)),
      total,
      query,
    );
  }

  async getTransaction(userId: string, id: string) {
    const tx = await this.financeRepo.findTransactionById(id, userId);
    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }
    return this.mapTransaction(tx);
  }

  async createTransaction(userId: string, dto: CreateTransactionDto) {
    const baseCurrency = this.config.get('BASE_CURRENCY', { infer: true });
    const currency = dto.currency ?? baseCurrency;
    const amountBaseCurrency = currency === baseCurrency ? dto.amount : dto.amount;

    const created = await this.financeRepo.createTransaction(
      userId,
      dto,
      amountBaseCurrency,
      'MANUAL',
    );

    if (!created) {
      throw new NotFoundException('Account not found');
    }

    this.eventEmitter.emit(
      AppEvents.TRANSACTION_CREATED,
      new TransactionCreatedEvent(
        userId,
        created.id,
        Number(decimalToString(created.amount)),
      ),
    );

    return this.mapTransaction(created);
  }

  async updateTransaction(
    userId: string,
    id: string,
    dto: Partial<CreateTransactionDto>,
  ) {
    const data: Prisma.FinTransactionUncheckedUpdateManyInput = {};

    if (dto.type !== undefined) data.type = dto.type;
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.accountId !== undefined) data.accountId = dto.accountId;
    if (dto.cardId !== undefined) data.cardId = dto.cardId;
    if (dto.merchant !== undefined) data.merchant = dto.merchant;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.transactionDate !== undefined) {
      data.transactionDate = new Date(dto.transactionDate);
    }
    if (dto.categoryId !== undefined) {
      data.categoryId = dto.categoryId;
    }

    const updated = await this.financeRepo.updateTransaction(userId, id, data);
    if (!updated) throw new NotFoundException('Transaction not found');
    return this.mapTransaction(updated);
  }

  async deleteTransaction(userId: string, id: string) {
    const result = await this.financeRepo.deleteTransaction(userId, id);
    if (result.count === 0) throw new NotFoundException('Manual transaction not found');
    return { success: true };
  }

  async confirmTransaction(userId: string, id: string) {
    const updated = await this.financeRepo.updateTransaction(userId, id, {
      status: 'CONFIRMED',
    });
    if (!updated) throw new NotFoundException('Transaction not found');
    return this.mapTransaction(updated);
  }

  async listInstitutions(userId: string) {
    const items = await this.financeRepo.listInstitutions(userId);
    return items.map((item) => this.mapInstitution(item));
  }

  async createInstitution(userId: string, dto: CreateInstitutionDto) {
    const created = await this.financeRepo.createInstitution(userId, {
      name: dto.name,
      color: dto.color,
      logoUrl: dto.logoUrl,
      country: dto.country ?? 'DO',
    });
    return this.mapInstitution(created);
  }

  async updateInstitution(userId: string, id: string, dto: UpdateInstitutionDto) {
    const updated = await this.financeRepo.updateInstitution(userId, id, dto);
    if (!updated) throw new NotFoundException('Institution not found');
    return this.mapInstitution(updated);
  }

  async deactivateInstitution(userId: string, id: string) {
    const updated = await this.financeRepo.updateInstitution(userId, id, { isActive: false });
    if (!updated) throw new NotFoundException('Institution not found');
    return { success: true };
  }

  async listCards(userId: string) {
    const cards = await this.financeRepo.listCards(userId);
    return cards.map((card) => this.mapCard(card));
  }

  async getCard(userId: string, id: string) {
    const card = await this.financeRepo.findCardById(userId, id);
    if (!card) throw new NotFoundException('Card not found');
    return this.mapCard(card);
  }

  async createCard(userId: string, dto: CreateCardDto) {
    const created = await this.financeRepo.createCard(userId, dto);
    return this.mapCard(created);
  }

  async updateCard(userId: string, id: string, dto: UpdateCardDto) {
    const updated = await this.financeRepo.updateCard(userId, id, dto);
    if (!updated) throw new NotFoundException('Card not found');
    return this.mapCard(updated);
  }

  async updateCardBalance(userId: string, id: string, dto: UpdateCardBalanceDto) {
    const updated = await this.financeRepo.upsertCardBalance(
      userId,
      id,
      dto.currency.toUpperCase(),
      dto.balance,
      dto.creditLimit,
    );
    if (!updated) throw new NotFoundException('Card not found');
    return {
      id: updated.id,
      cardId: updated.cardId,
      currency: updated.currency,
      balance: decimalToString(updated.balance),
      creditLimit: updated.creditLimit ? decimalToString(updated.creditLimit) : null,
    };
  }

  async listCategories(userId: string) {
    return this.financeRepo.listCategories(userId);
  }

  createCategory(userId: string, dto: CreateCategoryDto) {
    return this.financeRepo.createCategory(userId, dto);
  }

  async updateCategory(userId: string, id: string, dto: UpdateCategoryDto) {
    const updated = await this.financeRepo.updateCategory(userId, id, dto);
    if (!updated) throw new NotFoundException('Category not found');
    return updated;
  }

  async deleteCategory(userId: string, id: string) {
    const result = await this.financeRepo.deleteCategory(userId, id);
    if (result.count === 0) throw new NotFoundException('Category not found');
    return { success: true };
  }

  listBudgets(userId: string) {
    return this.financeRepo.listBudgets(userId);
  }

  createBudget(userId: string, dto: CreateBudgetDto) {
    return this.financeRepo.createBudget(userId, {
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
    const updated = await this.financeRepo.updateBudget(userId, id, {
      ...(dto.periodType ? { periodType: dto.periodType } : {}),
      ...(dto.periodStart ? { periodStart: new Date(dto.periodStart) } : {}),
      ...(dto.periodEnd ? { periodEnd: new Date(dto.periodEnd) } : {}),
      ...(dto.amountLimit !== undefined ? { amountLimit: dto.amountLimit } : {}),
      ...(dto.alertThresholdPct !== undefined ? { alertThresholdPct: dto.alertThresholdPct } : {}),
    });
    if (!updated) throw new NotFoundException('Budget not found');
    return updated;
  }

  async deleteBudget(userId: string, id: string) {
    const result = await this.financeRepo.deleteBudget(userId, id);
    if (result.count === 0) throw new NotFoundException('Budget not found');
    return { success: true };
  }

  listSavingsGoals(userId: string) {
    return this.financeRepo.listSavingsGoals(userId);
  }

  createSavingsGoal(userId: string, dto: CreateSavingsGoalDto) {
    return this.financeRepo.createSavingsGoal(userId, {
      name: dto.name,
      description: dto.description,
      targetAmount: dto.targetAmount,
      currentAmount: dto.currentAmount ?? 0,
      currency: dto.currency ?? 'DOP',
      targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
      isCompleted: (dto.currentAmount ?? 0) >= dto.targetAmount,
      completedAt: (dto.currentAmount ?? 0) >= dto.targetAmount ? new Date() : null,
    });
  }

  async updateSavingsGoal(userId: string, id: string, dto: UpdateSavingsGoalDto) {
    const updated = await this.financeRepo.updateSavingsGoal(userId, id, {
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.targetAmount !== undefined ? { targetAmount: dto.targetAmount } : {}),
      ...(dto.currentAmount !== undefined
        ? {
          currentAmount: dto.currentAmount,
          isCompleted: dto.targetAmount
            ? dto.currentAmount >= dto.targetAmount
            : undefined,
        }
        : {}),
      ...(dto.currency ? { currency: dto.currency } : {}),
      ...(dto.targetDate ? { targetDate: new Date(dto.targetDate) } : {}),
    });
    if (!updated) throw new NotFoundException('Savings goal not found');
    return updated;
  }

  async deleteSavingsGoal(userId: string, id: string) {
    const result = await this.financeRepo.deleteSavingsGoal(userId, id);
    if (result.count === 0) throw new NotFoundException('Savings goal not found');
    return { success: true };
  }

  listLoans(userId: string) {
    return this.financeRepo.listLoans(userId);
  }

  createLoan(userId: string, dto: CreateLoanDto) {
    return this.financeRepo.createLoan(userId, {
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
    const updated = await this.financeRepo.updateLoan(userId, id, {
      ...(dto.lenderName ? { lenderName: dto.lenderName } : {}),
      ...(dto.currentBalance !== undefined ? { currentBalance: dto.currentBalance } : {}),
      ...(dto.installmentAmount !== undefined ? { installmentAmount: dto.installmentAmount } : {}),
      ...(dto.installmentFreq ? { installmentFreq: dto.installmentFreq } : {}),
      ...(dto.totalInstallments !== undefined ? { totalInstallments: dto.totalInstallments } : {}),
      ...(dto.paidInstallments !== undefined ? { paidInstallments: dto.paidInstallments } : {}),
      ...(dto.nextDueDate ? { nextDueDate: new Date(dto.nextDueDate) } : {}),
    });
    if (!updated) throw new NotFoundException('Loan not found');
    return updated;
  }

  listReceivables(userId: string) {
    return this.financeRepo.listReceivables(userId);
  }

  createReceivable(userId: string, dto: CreateReceivableDto) {
    return this.financeRepo.createReceivable(userId, {
      debtorName: dto.debtorName,
      description: dto.description,
      amount: dto.amount,
      currency: dto.currency ?? 'DOP',
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
    });
  }

  async updateReceivable(userId: string, id: string, dto: UpdateReceivableDto) {
    const updated = await this.financeRepo.updateReceivable(userId, id, {
      ...(dto.debtorName ? { debtorName: dto.debtorName } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.currency ? { currency: dto.currency } : {}),
      ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}),
    });
    if (!updated) throw new NotFoundException('Receivable not found');
    return updated;
  }

  listEmailSources(userId: string) {
    return this.financeRepo.listEmailSources(userId).then((sources) =>
      sources.map((source) => this.mapEmailSourceResponse(source)),
    );
  }

  createEmailSource(userId: string, dto: ConnectEmailSourceDto) {
    return this.financeRepo.createEmailSource(userId, {
      provider: 'gmail',
      emailAddress: dto.emailAddress,
      bankDomain: dto.bankDomain,
      label: dto.label,
      accountId: dto.accountId,
      isActive: true,
    });
  }

  async updateEmailSource(userId: string, id: string, dto: UpdateEmailSourceDto) {
    if (dto.accountId) {
      await this.assertAccountOwnership(userId, dto.accountId);
    }

    const data: Prisma.FinEmailSourceUncheckedUpdateInput = {};
    if (dto.accountId !== undefined) data.accountId = dto.accountId;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.bankDomain !== undefined) data.bankDomain = dto.bankDomain.trim();

    const updated = await this.financeRepo.updateEmailSource(userId, id, data);
    if (!updated) throw new NotFoundException('Email source not found');
    return this.mapEmailSourceResponse(updated);
  }

  async deactivateEmailSource(userId: string, id: string) {
    const updated = await this.financeRepo.updateEmailSource(userId, id, { isActive: false });
    if (!updated) throw new NotFoundException('Email source not found');
    return { success: true };
  }

  async triggerEmailSync(userId: string, sourceId: string, forceFullSync = false) {
    const source = await this.financeRepo.findEmailSource(userId, sourceId);
    if (!source) throw new NotFoundException('Email source not found');
    if (!this.gmailSyncQueue) {
      return {
        queued: false,
        reason:
          'gmail-sync queue is unavailable. Verify REDIS_ENABLED=true and REDIS_URL, then restart the API.',
      };
    }

    await this.gmailSyncQueue.add(
      'gmail-sync-source',
      { userId, sourceId, forceFullSync },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1500 },
        removeOnComplete: 100,
        removeOnFail: 300,
      },
    );

    return { queued: true };
  }

  private get encryptionKey(): string {
    return this.config.get('ENCRYPTION_KEY', { infer: true });
  }

  getGoogleOAuthUrl(userId: string, query: GoogleOAuthUrlQueryDto = {}): { url: string } {
    const bankDomain = query.bankDomain?.trim() || 'bhd.com.do';
    const state = jwt.sign(
      {
        sub: userId,
        bankDomain,
        label: query.label?.trim() || undefined,
        accountId: query.accountId?.trim() || undefined,
      },
      this.encryptionKey,
      { expiresIn: '15m' },
    );

    const params = new URLSearchParams({
      client_id: this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
      redirect_uri: this.config.get('GOOGLE_REDIRECT_URI', { infer: true }),
      response_type: 'code',
      scope:
        'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  }

  async handleGoogleOAuthCallback(code: string, state: string) {
    let payload: { sub: string; bankDomain: string; label?: string; accountId?: string };
    try {
      payload = jwt.verify(state, this.encryptionKey) as {
        sub: string;
        bankDomain: string;
        label?: string;
        accountId?: string;
      };
    } catch {
      throw new BadRequestException('Invalid or expired OAuth state');
    }

    if (payload.accountId) {
      await this.assertAccountOwnership(payload.sub, payload.accountId);
    }

    const tokenResponse = await exchangeGoogleAuthCode(
      code,
      this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
      this.config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      this.config.get('GOOGLE_REDIRECT_URI', { infer: true }),
    );

    const emailAddress = await fetchGoogleUserEmail(tokenResponse.access_token);
    const encryptedAccess = encryptToken(tokenResponse.access_token, this.encryptionKey);
    const refreshToken = tokenResponse.refresh_token;
    if (!refreshToken) {
      throw new BadRequestException('Google did not return a refresh token');
    }
    const encryptedRefresh = encryptToken(refreshToken, this.encryptionKey);
    const tokenExpiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    const existing = await this.financeRepo.findEmailSourceByUserEmailAndDomain(
      payload.sub,
      emailAddress,
      payload.bankDomain,
    );

    if (existing) {
      return this.financeRepo.updateEmailSourceTokens(existing.id, {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt,
        emailAddress,
        ...(payload.accountId ? { accountId: payload.accountId } : {}),
      });
    }

    return this.financeRepo.createEmailSource(payload.sub, {
      provider: 'gmail',
      emailAddress,
      bankDomain: payload.bankDomain,
      label: payload.label,
      accountId: payload.accountId,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt,
      isActive: true,
    });
  }

  async refreshGmailToken(sourceId: string): Promise<string> {
    const source = await this.financeRepo.findEmailSourceForRefresh(sourceId);
    if (!source?.refreshToken || !source.accessToken) {
      throw new NotFoundException('Email source tokens not found');
    }

    const refreshToken = decryptToken(source.refreshToken, this.encryptionKey);
    const tokenResponse = await refreshGoogleAccessToken(
      refreshToken,
      this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
      this.config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
    );

    const encryptedAccess = encryptToken(tokenResponse.access_token, this.encryptionKey);
    const tokenExpiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    await this.financeRepo.updateEmailSourceTokens(sourceId, {
      accessToken: encryptedAccess,
      refreshToken: source.refreshToken,
      tokenExpiresAt,
    });

    return tokenResponse.access_token;
  }

  async getValidGmailAccessToken(sourceId: string): Promise<string> {
    const source = await this.financeRepo.findEmailSourceForRefresh(sourceId);
    if (!source?.accessToken) {
      throw new NotFoundException('Email source tokens not found');
    }

    const expiresSoon =
      !source.tokenExpiresAt ||
      source.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;

    if (expiresSoon) {
      return this.refreshGmailToken(sourceId);
    }

    return decryptToken(source.accessToken, this.encryptionKey);
  }

  async getAnalyticsSummary(userId: string, dateFrom?: string, dateTo?: string) {
    const from = dateFrom ? new Date(dateFrom) : undefined;
    const to = dateTo ? new Date(dateTo) : undefined;
    const { accounts, cardBalances, txs } = await this.financeRepo.getAnalyticsSummary(
      userId,
      from,
      to,
    );

    const totalAccountBalance = accounts.reduce((acc, item) => acc + Number(item.balance), 0);
    const totalCardDebt = cardBalances
      .filter((item) => item.card.type === 'CREDIT')
      .reduce((acc, item) => acc + Math.abs(Number(item.balance)), 0);

    const income = txs
      .filter((item) => item.type === 'CREDIT')
      .reduce((acc, item) => acc + Number(item.amountBaseCurrency), 0);
    const expenses = txs
      .filter((item) => item.type === 'DEBIT')
      .reduce((acc, item) => acc + Number(item.amountBaseCurrency), 0);

    return {
      netWorth: totalAccountBalance - totalCardDebt,
      cashFlow: income - expenses,
      totals: {
        accountBalance: totalAccountBalance,
        cardDebt: totalCardDebt,
        income,
        expenses,
      },
    };
  }

  async getSpendingByCategory(userId: string, dateFrom?: string, dateTo?: string) {
    const grouped = await this.financeRepo.getSpendingByCategory(
      userId,
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined,
    );
    return grouped.map((item) => ({
      categoryId: item.categoryId,
      total: item._sum.amountBaseCurrency ? Number(item._sum.amountBaseCurrency) : 0,
    }));
  }

  async getSpendingOverTime(
    userId: string,
    dateFrom?: string,
    dateTo?: string,
    granularity: 'day' | 'week' | 'month' = 'day',
  ) {
    const rows = await this.financeRepo.getSpendingOverTime(
      userId,
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined,
      granularity,
    );

    const byDate = new Map<string, { date: string; expenses: number; income: number }>();

    for (const row of rows) {
      const date =
        row.bucket instanceof Date
          ? row.bucket.toISOString().slice(0, 10)
          : String(row.bucket).slice(0, 10);
      const entry = byDate.get(date) ?? { date, expenses: 0, income: 0 };
      const total = Number(row.total) || 0;
      if (row.type === 'DEBIT') entry.expenses += total;
      if (row.type === 'CREDIT') entry.income += total;
      byDate.set(date, entry);
    }

    return {
      points: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async migrateLegacyCategoryIcons(userId: string) {
    const categories = await this.financeRepo.listUserCategories(userId);
    let updated = 0;

    for (const category of categories) {
      if (category.isSystem) continue;
      const emoji = normalizeLegacyCategoryIcon(category.icon);
      if (!emoji || emoji === category.icon) continue;
      await this.financeRepo.updateCategory(userId, category.id, { icon: emoji });
      updated += 1;
    }

    return { updated };
  }

  async getBudgetStatus(userId: string) {
    const budgets = await this.financeRepo.listBudgets(userId);
    return budgets.map((budget) => {
      const limit = Number(budget.amountLimit);
      const spent = Number(budget.amountSpent);
      const pctUsed = limit > 0 ? (spent / limit) * 100 : 0;
      return {
        id: budget.id,
        categoryId: budget.categoryId,
        category: budget.category.name,
        periodType: budget.periodType,
        periodStart: budget.periodStart.toISOString().slice(0, 10),
        periodEnd: budget.periodEnd.toISOString().slice(0, 10),
        amountLimit: limit,
        amountSpent: spent,
        pctUsed,
        threshold: Number(budget.alertThresholdPct),
      };
    });
  }

  private async assertAccountOwnership(userId: string, accountId: string) {
    const account = await this.financeRepo.findAccountById(accountId, userId);
    if (!account) {
      throw new BadRequestException('Account not found');
    }
    return account;
  }

  private mapEmailSourceResponse(source: {
    id: string;
    emailAddress: string;
    bankDomain: string;
    label: string | null;
    accountId: string | null;
    provider: string;
    isActive: boolean;
    lastSyncedAt: Date | null;
    createdAt: Date;
    logs?: Array<{
      id: string;
      status: string;
      error: string | null;
      emailsScanned: number;
      transactionsNew: number;
      startedAt: Date;
      completedAt: Date | null;
    }>;
  }) {
    return {
      id: source.id,
      emailAddress: source.emailAddress,
      bankDomain: source.bankDomain,
      label: source.label,
      accountId: source.accountId,
      provider: source.provider,
      isActive: source.isActive,
      lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
      createdAt: source.createdAt.toISOString(),
      logs: (source.logs ?? []).map((log) => ({
        id: log.id,
        status: log.status,
        error: log.error,
        emailsScanned: log.emailsScanned,
        transactionsNew: log.transactionsNew,
        startedAt: log.startedAt.toISOString(),
        completedAt: log.completedAt?.toISOString() ?? null,
      })),
    };
  }
}
