import { Injectable, NotFoundException } from '@nestjs/common';
import { clampPageLimit, toCursorPage } from '@personal-os/core';
import type { CursorQueryDto } from '@personal-os/core';
import { CatalogAccountRepository } from '../infrastructure/catalog-account.repository';
import { CatalogAccountRules } from './catalog-account-rules';
import { CatalogViews } from './catalog-views';

/** Accounts read with their earmarked money: list, page, detail and batch. */
@Injectable()
export class CatalogAccountReads {
  constructor(
    private readonly repo: CatalogAccountRepository,
    private readonly rules: CatalogAccountRules,
    private readonly views: CatalogViews,
  ) {}

  async listAccounts(userId: string) {
    await this.rules.ensureCash(userId);
    const accounts = await this.repo.findAccountsByUser(userId);
    const earmarked = await this.repo.sumEarmarkedByAccountIds(
      userId,
      accounts.map((account) => account.id),
    );
    return accounts.map((account) =>
      this.views.account(account, earmarked.get(account.id) ?? 0),
    );
  }

  async listAccountsPage(userId: string, query: CursorQueryDto) {
    await this.rules.ensureCash(userId);
    const rows = await this.repo.findAccountsPage(userId, query);
    const page = toCursorPage(
      rows,
      clampPageLimit(query.limit),
      (row) => row.name,
    );
    const earmarked = await this.repo.sumEarmarkedByAccountIds(
      userId,
      page.items.map((account) => account.id),
    );
    return {
      ...page,
      items: page.items.map((account) =>
        this.views.account(account, earmarked.get(account.id) ?? 0),
      ),
    };
  }

  async getAccount(userId: string, id: string) {
    const account = await this.repo.findAccountById(id, userId);
    if (!account) {
      throw new NotFoundException('Cuenta no encontrada');
    }
    const earmarked = await this.repo.sumEarmarkedByAccountIds(userId, [id]);
    return this.views.account(account, earmarked.get(id) ?? 0);
  }

  /** Public account shape for the writes, without reading it again. */
  presentAccount(
    row: NonNullable<
      Awaited<ReturnType<CatalogAccountRepository['findAccountById']>>
    >,
  ) {
    return this.views.account(row);
  }

  /** Same public shape as `getAccount`, loaded in batch and without throwing. */
  async lookupAccounts(userId: string, ids: readonly string[]) {
    const rows = await this.repo.findAccountsByIds(userId, ids);
    const earmarked = await this.repo.sumEarmarkedByAccountIds(userId, [
      ...rows.map((row) => row.id),
    ]);
    return new Map(
      rows.map((row) => [
        row.id,
        this.views.account(row, earmarked.get(row.id) ?? 0),
      ]),
    );
  }
}
