import type { DomainEventPublisher } from '@personal-os/contracts';
import { DOMAIN_EVENT_PUBLISHER } from '@personal-os/contracts';
import { FinanceEvents } from '../../contracts';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { roundMoney } from '../../shared/domain/money';
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

export type IntegrityRecalculateResult = {
  corrected: boolean;
  accountId: string | null;
  cardId: string | null;
  currency: string;
  balance: string;
};

type DetectedProduct = {
  target: IntegrityTarget;
  currency: string;
  storedCents: number;
  expectedCents: number;
};

const ACCOUNT_NOT_FOUND = 'Cuenta no encontrada';
const CARD_BALANCE_NOT_FOUND = 'Saldo de tarjeta no encontrado';

function moneyString(value: { toString(): string } | number): string {
  return roundMoney(Number(value)).toFixed(2);
}

function toCents(value: { toString(): string }): number {
  return Math.round(Number(value) * 100);
}

function toView(row: BalanceDriftRow): BalanceDriftView {
  return {
    id: row.id,
    accountId: row.accountId,
    cardId: row.cardId,
    currency: row.currency,
    name: row.account?.name ?? row.card?.name ?? null,
    storedBalance: moneyString(row.storedBalance),
    expectedBalance: moneyString(row.expectedBalance),
    difference: moneyString(row.difference),
    detectedAt: row.detectedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

function matchesTarget(
  drift: BalanceDriftRow,
  product: DetectedProduct,
): boolean {
  if ('accountId' in product.target && product.target.accountId) {
    return drift.accountId === product.target.accountId;
  }
  return (
    drift.cardId === product.target.cardId &&
    drift.currency === product.currency
  );
}

@Injectable()
export class BalanceIntegrityService {
  constructor(
    private readonly repo: IntegrityRepository,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisher,
  ) {}

  async check(
    userId: string,
    target?: IntegrityTarget,
  ): Promise<IntegrityCheckResult> {
    const { drifts } = await this.detectAndRecord(userId, target, new Date());
    return { drifts: drifts.map(toView) };
  }

  async recalculate(
    userId: string,
    target: IntegrityTarget,
  ): Promise<IntegrityRecalculateResult> {
    if (!('accountId' in target) && !target.currency) {
      throw new BadRequestException(
        'El recálculo de tarjeta requiere una moneda',
      );
    }
    const snapshot = await this.repo.loadSnapshot(userId);
    const expected = computeExpectedBalances(snapshot);
    const product = this.selectProduct(expected, target);
    if (!product) {
      throw new NotFoundException(
        'accountId' in target ? ACCOUNT_NOT_FOUND : CARD_BALANCE_NOT_FOUND,
      );
    }

    const now = new Date();
    const open = await this.repo.findOpenDrift(
      userId,
      target,
      product.currency,
    );
    await this.repo.correctBalance({
      userId,
      target,
      currency: product.currency,
      expectedCents: product.expectedCents,
      now,
    });

    return {
      corrected: open !== null || product.storedCents !== product.expectedCents,
      accountId: product.target.accountId ?? null,
      cardId: product.target.cardId ?? null,
      currency: product.currency,
      balance: moneyString(product.expectedCents / 100),
    };
  }

  /** Nightly sweep for one user; emits one event per newly changed drift. */
  async runForUser(userId: string): Promise<number> {
    const { changed } = await this.detectAndRecord(
      userId,
      undefined,
      new Date(),
    );
    for (const drift of changed) {
      await this.events.enqueue({
        eventName: FinanceEvents.BALANCE_DRIFT_DETECTED,
        aggregateType: 'FinBalanceDrift',
        aggregateId: drift.id,
        userId,
        payload: {
          driftId: drift.id,
          accountId: drift.accountId,
          cardId: drift.cardId,
          currency: drift.currency,
          name: drift.account?.name ?? drift.card?.name ?? null,
          storedBalance: moneyString(drift.storedBalance),
          expectedBalance: moneyString(drift.expectedBalance),
          difference: moneyString(drift.difference),
        },
      });
    }
    return changed.length;
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
  ): DetectedProduct[] {
    const accounts = expected.accounts
      .filter(
        (account) =>
          !target ||
          ('accountId' in target && target.accountId === account.accountId),
      )
      .map((account): DetectedProduct => ({
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
      .map((card): DetectedProduct => ({
        target: { cardId: card.cardId, currency: card.currency },
        currency: card.currency,
        storedCents: card.storedCents,
        expectedCents: card.expectedCents,
      }));
    return [...accounts, ...cards];
  }

  private selectProduct(
    expected: ExpectedBalances,
    target: IntegrityTarget,
  ): DetectedProduct | null {
    return this.selectProducts(expected, target)[0] ?? null;
  }
}
