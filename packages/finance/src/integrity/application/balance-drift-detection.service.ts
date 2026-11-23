import { NotFoundException } from '@nestjs/common';
import {
  computeExpectedBalances,
  hasDrift,
  type ExpectedBalances,
} from '../domain/expected-balance';
import {
  IntegrityRepository,
  type BalanceDriftRow,
  type IntegrityTarget,
} from '../infrastructure/integrity.repository';
import { moneyLabel, toCents } from './integrity-money';
import {
  ACCOUNT_NOT_FOUND,
  CARD_BALANCE_NOT_FOUND,
} from './integrity-messages';

export type BalanceDriftView = {
  id: string;
  accountId: string | null;
  cardId: string | null;
  currency: string;
  name: string | null;
  storedBalance: string;
  expectedBalance: string;
  difference: string;
  detectedAt: string;
  resolvedAt: string | null;
};

export type IntegrityCheckResult = {
  drifts: BalanceDriftView[];
};

export type IntegrityProduct = {
  target: IntegrityTarget;
  currency: string;
  storedCents: number;
  expectedCents: number;
};

function toView(row: BalanceDriftRow): BalanceDriftView {
  return {
    id: row.id,
    accountId: row.accountId,
    cardId: row.cardId,
    currency: row.currency,
    name: row.account?.name ?? row.card?.name ?? null,
    storedBalance: moneyLabel(row.storedBalance),
    expectedBalance: moneyLabel(row.expectedBalance),
    difference: moneyLabel(row.difference),
    detectedAt: row.detectedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

function matchesTarget(
  drift: BalanceDriftRow,
  product: IntegrityProduct,
): boolean {
  if ('accountId' in product.target && product.target.accountId) {
    return drift.accountId === product.target.accountId;
  }
  return (
    drift.cardId === product.target.cardId &&
    drift.currency === product.currency
  );
}

/** Compares stored balances with the movements and keeps their drifts current. */
export class BalanceDriftDetectionService {
  constructor(private readonly repo: IntegrityRepository) {}

  async check(
    userId: string,
    target?: IntegrityTarget,
  ): Promise<IntegrityCheckResult> {
    const { drifts } = await this.detectAndRecord(userId, target, new Date());
    return { drifts: drifts.map(toView) };
  }

  /** Drifts a sweep must announce: only those whose difference changed. */
  async sweep(userId: string): Promise<{ changed: BalanceDriftRow[] }> {
    const { changed } = await this.detectAndRecord(
      userId,
      undefined,
      new Date(),
    );
    return { changed };
  }

  /** Expected state of one product, or null when the user does not own it. */
  async findProduct(
    userId: string,
    target: IntegrityTarget,
  ): Promise<IntegrityProduct | null> {
    const snapshot = await this.repo.loadSnapshot(userId);
    const expected = computeExpectedBalances(snapshot);
    return this.selectProducts(expected, target)[0] ?? null;
  }

  private async detectAndRecord(
    userId: string,
    target: IntegrityTarget | undefined,
    now: Date,
  ): Promise<{ drifts: BalanceDriftRow[]; changed: BalanceDriftRow[] }> {
    const snapshot = await this.repo.loadSnapshot(userId);
    const expected = computeExpectedBalances(snapshot);
    const products = this.selectProducts(expected, target);
    if (target && products.length === 0) {
      throw new NotFoundException(
        'accountId' in target ? ACCOUNT_NOT_FOUND : CARD_BALANCE_NOT_FOUND,
      );
    }

    const openDrifts = await this.repo.listOpenDrifts(userId, target);
    const changed: BalanceDriftRow[] = [];

    for (const product of products) {
      if (!hasDrift(product)) {
        continue;
      }
      const existing = openDrifts.find((drift) =>
        matchesTarget(drift, product),
      );
      if (!existing) {
        changed.push(
          await this.repo.createDrift({
            userId,
            target: product.target,
            currency: product.currency,
            storedCents: product.storedCents,
            expectedCents: product.expectedCents,
            detectedAt: now,
          }),
        );
        continue;
      }
      const storedCents = toCents(existing.storedBalance);
      const expectedCents = toCents(existing.expectedBalance);
      if (
        storedCents === product.storedCents &&
        expectedCents === product.expectedCents
      ) {
        continue;
      }
      const differenceCents = product.expectedCents - product.storedCents;
      const updated = await this.repo.updateDrift({
        id: existing.id,
        userId,
        target: product.target,
        currency: product.currency,
        storedCents: product.storedCents,
        expectedCents: product.expectedCents,
        detectedAt: now,
      });
      if (toCents(existing.difference) !== differenceCents) {
        changed.push(updated);
      }
    }

    for (const drift of openDrifts) {
      if (
        products.some(
          (product) => matchesTarget(drift, product) && hasDrift(product),
        )
      ) {
        continue;
      }
      await this.repo.resolveDrift(drift.id, now);
    }

    return {
      drifts: await this.repo.listOpenDrifts(userId, target),
      changed,
    };
  }

  private selectProducts(
    expected: ExpectedBalances,
    target?: IntegrityTarget,
  ): IntegrityProduct[] {
    const accounts = expected.accounts
      .filter(
        (account) =>
          !target ||
          ('accountId' in target && target.accountId === account.accountId),
      )
      .map((account): IntegrityProduct => ({
        target: { accountId: account.accountId },
        currency: account.currency,
        storedCents: account.storedCents,
        expectedCents: account.expectedCents,
      }));
    const cards = expected.cards
      .filter(
        (card) =>
          !target ||
          ('cardId' in target &&
            target.cardId === card.cardId &&
            (!target.currency ||
              target.currency.toUpperCase() === card.currency)),
      )
      .map((card): IntegrityProduct => ({
        target: { cardId: card.cardId, currency: card.currency },
        currency: card.currency,
        storedCents: card.storedCents,
        expectedCents: card.expectedCents,
      }));
    return [...accounts, ...cards];
  }
}
