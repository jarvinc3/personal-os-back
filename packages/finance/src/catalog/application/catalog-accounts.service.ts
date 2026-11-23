import { Injectable } from '@nestjs/common';
import type { CursorQueryDto } from '@personal-os/core';
import type { CreateAccountDto } from '../presentation/dto/create-account.dto';
import type { UpdateAccountDto } from '../presentation/dto/update-account.dto';
import { CatalogAccountLifecycle } from './catalog-account-lifecycle';
import { CatalogAccountMutations } from './catalog-account-mutations';
import { CatalogAccountReads } from './catalog-account-reads';

/** Accounts: reads, writes and lifecycle with the same public surface. */
@Injectable()
export class CatalogAccountsService {
  constructor(
    private readonly reads: CatalogAccountReads,
    private readonly mutations: CatalogAccountMutations,
    private readonly lifecycle: CatalogAccountLifecycle,
  ) {}

  listAccounts(userId: string) {
    return this.reads.listAccounts(userId);
  }

  listAccountsPage(userId: string, query: CursorQueryDto) {
    return this.reads.listAccountsPage(userId, query);
  }

  getAccount(userId: string, id: string) {
    return this.reads.getAccount(userId, id);
  }

  lookupAccounts(userId: string, ids: readonly string[]) {
    return this.reads.lookupAccounts(userId, ids);
  }

  async createAccount(userId: string, dto: CreateAccountDto) {
    const created = await this.mutations.createAccount(userId, dto);
    return this.reads.presentAccount(created);
  }

  async updateAccount(userId: string, id: string, dto: UpdateAccountDto) {
    const updated = await this.mutations.updateAccount(userId, id, dto);
    return this.reads.presentAccount(updated);
  }

  deleteAccount(userId: string, id: string) {
    return this.lifecycle.deleteAccount(userId, id);
  }

  restoreAccount(userId: string, id: string, now: Date) {
    return this.lifecycle.restoreAccount(userId, id, now);
  }
}
