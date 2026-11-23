import { NotFoundException } from '@nestjs/common';
import { clampPageLimit, decodeCursor, toCursorPage } from '@personal-os/core';
import type { LogoService } from '@personal-os/logos';
import { countPossibleDuplicates } from '../domain/merchant-duplicates';
import type { MerchantsRepository } from '../infrastructure/merchants.repository';
import type { ListMerchantsQueryDto } from '../presentation/dto/list-merchants-query.dto';
import type { MerchantDuplicates } from './merchant-duplicates';
import {
  comparableMerchant,
  merchantMonthRange,
  toMerchantView,
  type MerchantPageView,
  type MerchantView,
} from './merchant-view';

type MerchantDirectoryDeps = {
  repo: MerchantsRepository;
  logos: LogoService;
  duplicates: MerchantDuplicates;
};

/** Read side of merchants: list, detail and the batch view. */
export class MerchantDirectory {
  private readonly repo: MerchantsRepository;
  private readonly logos: LogoService;
  private readonly duplicates: MerchantDuplicates;

  constructor({ repo, logos, duplicates }: MerchantDirectoryDeps) {
    this.repo = repo;
    this.logos = logos;
    this.duplicates = duplicates;
  }

  async list(
    userId: string,
    query: ListMerchantsQueryDto,
    now = new Date(),
  ): Promise<MerchantPageView> {
    const limit = clampPageLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.repo.listMerchants(userId, {
      cursor,
      take: limit + 1,
      search: query.search,
    });
    const page = toCursorPage(rows, limit, (row) =>
      row.createdAt.toISOString(),
    );
    const spends = await this.repo.sumSpendByMerchant(
      userId,
      page.items.map((row) => row.id),
      merchantMonthRange(query, now),
    );
    const spendByMerchant = new Map(
      spends.map((spend) => [spend.merchantId, spend] as const),
    );
    const comparables = (await this.repo.listMerchantComparables(userId)).map(
      comparableMerchant,
    );
    const dismissed = await this.duplicates.dismissedByMerchant(userId);
    return {
      ...page,
      items: page.items.map((row) => ({
        ...toMerchantView(row, spendByMerchant.get(row.id), this.logos),
        possibleDuplicates: countPossibleDuplicates(
          comparableMerchant(row),
          comparables,
          dismissed.get(row.id) ?? new Set<string>(),
        ),
      })),
    };
  }

  async get(
    userId: string,
    id: string,
    now = new Date(),
  ): Promise<MerchantView> {
    const merchant = await this.repo.findMerchantById(userId, id);
    if (!merchant) {
      throw new NotFoundException('Comercio no encontrado');
    }
    const spends = await this.repo.sumSpendByMerchant(
      userId,
      [id],
      merchantMonthRange({}, now),
    );
    return toMerchantView(merchant, spends[0], this.logos);
  }

  /** Merchants with the same shape as `get`, in batch and without throwing. */
  async lookupMerchants(
    userId: string,
    ids: readonly string[],
    now = new Date(),
  ): Promise<Map<string, MerchantView>> {
    const rows = await this.repo.findMerchantsByIds(userId, ids);
    const spends = await this.repo.sumSpendByMerchant(
      userId,
      rows.map((row) => row.id),
      merchantMonthRange({}, now),
    );
    const spendByMerchant = new Map(
      spends.map((spend) => [spend.merchantId, spend] as const),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        toMerchantView(row, spendByMerchant.get(row.id), this.logos),
      ]),
    );
  }
}
