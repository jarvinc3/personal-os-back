import { BadRequestException, NotFoundException } from '@nestjs/common';
import { decimalToString } from '../../shared/domain/mappers';
import { findDuplicateCandidates } from '../domain/merchant-duplicates';
import type { MerchantsRepository } from '../infrastructure/merchants.repository';
import {
  comparableMerchant,
  DUPLICATE_CANDIDATE_LIMIT,
  merchantMonthRange,
  type MerchantDuplicateView,
} from './merchant-view';

type DismissedPair = {
  merchantId: string;
  otherMerchantId: string;
};

/** Duplicate suggestions and the pairs the user marked as "not duplicates". */
export class MerchantDuplicates {
  constructor(private readonly repo: MerchantsRepository) {}

  async list(
    userId: string,
    id: string,
    now = new Date(),
  ): Promise<MerchantDuplicateView[]> {
    const target = await this.repo.findMerchantById(userId, id);
    if (!target) {
      throw new NotFoundException('Comercio no encontrado');
    }
    const dismissed = await this.dismissedByMerchant(userId);
    const dismissedForTarget = dismissed.get(id) ?? new Set<string>();
    const others = (await this.repo.listMerchantComparables(userId))
      .filter((row) => row.id !== id && !dismissedForTarget.has(row.id))
      .map(comparableMerchant);
    const candidates = findDuplicateCandidates(
      comparableMerchant(target),
      others,
      DUPLICATE_CANDIDATE_LIMIT,
    );
    const spends = await this.repo.sumSpendByMerchant(
      userId,
      candidates.map((candidate) => candidate.merchant.id),
      merchantMonthRange({}, now),
    );
    const spendByMerchant = new Map(
      spends.map((spend) => [spend.merchantId, spend] as const),
    );
    return candidates.map(({ merchant, reason }) => ({
      id: merchant.id,
      name: merchant.name,
      logoUrl: merchant.logoUrl,
      monthSpend: decimalToString(spendByMerchant.get(merchant.id)?.spend ?? 0),
      monthMovements: spendByMerchant.get(merchant.id)?.movements ?? 0,
      reason,
    }));
  }

  /** Marks a pair as "not a duplicate"; repeating it changes nothing. */
  async dismiss(
    userId: string,
    id: string,
    otherId: string,
  ): Promise<{ dismissed: boolean }> {
    const pair = await this.requireDismissiblePair(userId, id, otherId);
    await this.repo.dismissPair(userId, pair.merchantId, pair.otherMerchantId);
    return { dismissed: true };
  }

  /** Undoes a dismissal, so the pair can be suggested again. */
  async undoDismiss(
    userId: string,
    id: string,
    otherId: string,
  ): Promise<{ dismissed: boolean }> {
    const pair = await this.requireDismissiblePair(userId, id, otherId);
    await this.repo.undoDismissPair(
      userId,
      pair.merchantId,
      pair.otherMerchantId,
    );
    return { dismissed: false };
  }

  /** Dismissed partners of every merchant, for the count on the list. */
  async dismissedByMerchant(userId: string): Promise<Map<string, Set<string>>> {
    const pairs = await this.repo.listDismissedPairs(userId);
    const byMerchant = new Map<string, Set<string>>();
    const add = (merchantId: string, partnerId: string): void => {
      const partners = byMerchant.get(merchantId) ?? new Set<string>();
      partners.add(partnerId);
      byMerchant.set(merchantId, partners);
    };
    for (const pair of pairs) {
      add(pair.merchantId, pair.otherMerchantId);
      add(pair.otherMerchantId, pair.merchantId);
    }
    return byMerchant;
  }

  /**
   * Both merchants must belong to the user, and the pair is stored in
   * canonical order, so A-B and B-A are the same record.
   */
  private async requireDismissiblePair(
    userId: string,
    id: string,
    otherId: string,
  ): Promise<DismissedPair> {
    if (id === otherId) {
      throw new BadRequestException(
        'No se puede descartar un comercio consigo mismo',
      );
    }
    const [merchant, other] = await Promise.all([
      this.repo.findMerchantById(userId, id),
      this.repo.findMerchantById(userId, otherId),
    ]);
    if (!merchant || !other) {
      throw new NotFoundException('Comercio no encontrado');
    }
    return merchant.id < other.id
      ? { merchantId: merchant.id, otherMerchantId: other.id }
      : { merchantId: other.id, otherMerchantId: merchant.id };
  }
}
