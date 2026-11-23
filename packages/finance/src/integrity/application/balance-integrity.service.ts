import type { DomainEventPublisher } from '@personal-os/contracts';
import { DOMAIN_EVENT_PUBLISHER } from '@personal-os/contracts';
import { FinanceEvents } from '../../contracts';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IntegrityRepository,
  type IntegrityTarget,
} from '../infrastructure/integrity.repository';
import {
  BalanceDriftDetectionService,
  type IntegrityCheckResult,
} from './balance-drift-detection.service';
import { moneyLabel } from './integrity-money';

export type IntegrityRecalculateResult = {
  corrected: boolean;
  accountId: string | null;
  cardId: string | null;
  currency: string;
  balance: string;
};

const ACCOUNT_NOT_FOUND = 'Cuenta no encontrada';
const CARD_BALANCE_NOT_FOUND = 'Saldo de tarjeta no encontrado';

@Injectable()
export class BalanceIntegrityService {
  private readonly detection: BalanceDriftDetectionService;

  constructor(
    private readonly repo: IntegrityRepository,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisher,
  ) {
    this.detection = new BalanceDriftDetectionService(repo);
  }

  check(
    userId: string,
    target?: IntegrityTarget,
  ): Promise<IntegrityCheckResult> {
    return this.detection.check(userId, target);
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
    const product = await this.detection.findProduct(userId, target);
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
      balance: moneyLabel(product.expectedCents / 100),
    };
  }

  /** Nightly sweep for one user; emits one event per newly changed drift. */
  async runForUser(userId: string): Promise<number> {
    const { changed } = await this.detection.sweep(userId);
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
          storedBalance: moneyLabel(drift.storedBalance),
          expectedBalance: moneyLabel(drift.expectedBalance),
          difference: moneyLabel(drift.difference),
        },
      });
    }
    return changed.length;
  }
}
