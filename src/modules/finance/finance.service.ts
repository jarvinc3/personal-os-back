import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Env } from '../../config';
import { AppEvents } from '../../core/events/event.constants';
import { TransactionCreatedEvent } from '../../core/events/domain-events';
import { paginate } from '../../core/pagination/pagination.dto';
import type { CreateAccountDto } from './dto/create-account.dto';
import type { CreateTransactionDto } from './dto/create-transaction.dto';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import type { UpdateAccountDto } from './dto/update-account.dto';
import { FinanceRepository } from './finance.repository';

function decimalToString(value: { toString(): string }) {
  return value.toString();
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly financeRepo: FinanceRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private mapAccount(account: Awaited<ReturnType<FinanceRepository['findAccountsByUser']>>[number]) {
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      institution: account.institution,
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
      accountName: tx.account.name,
      type: tx.type,
      amount: decimalToString(tx.amount),
      amountBaseCurrency: decimalToString(tx.amountBaseCurrency),
      currency: tx.currency,
      merchant: tx.merchant,
      description: tx.description,
      transactionDate: tx.transactionDate.toISOString().slice(0, 10),
      status: tx.status,
      categoryId: tx.categoryId,
      createdAt: tx.createdAt.toISOString(),
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
}
