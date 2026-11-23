import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { clampPageLimit, decodeCursor, toCursorPage } from '@personal-os/core';
import { roundDecimal, scalarNumber } from '../../shared/domain/money';
import { nextBillingAfter } from '../domain/billing';
import { matchesSubscription } from '../domain/payment-matching';
import type { SubscriptionRow } from '../infrastructure/subscriptions.repository';
import { SubscriptionsRepository } from '../infrastructure/subscriptions.repository';
import type { CreateSubscriptionPaymentDto } from '../presentation/dto/create-subscription-payment.dto';
import { dateOnly } from './subscription-dates';

export type RecordManualPaymentInput = {
  userId: string;
  id: string;
  dto: CreateSubscriptionPaymentDto;
  now: Date;
};

/** Payments of a subscription: listing, manual entry and movement matching. */
export class SubscriptionPayments {
  constructor(private readonly repo: SubscriptionsRepository) {}

  async list(
    userId: string,
    id: string,
    query: { limit?: number; cursor?: string },
  ) {
    const subscription = await this.repo.findById(userId, id);
    if (!subscription) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    const limit = clampPageLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.repo.listPayments(userId, id, {
      cursor,
      take: limit + 1,
    });
    const page = toCursorPage(rows, limit, (row) => row.paidAt.toISOString());
    return {
      ...page,
      items: page.items.map((row) => ({
        id: row.id,
        amount: row.amount.toFixed(2),
        currency: row.currency,
        paidAt: row.paidAt.toISOString(),
        source: row.source,
        transactionId: row.transactionId,
        transaction: row.transaction
          ? {
              id: row.transaction.id,
              merchant: row.transaction.merchant,
              amount: row.transaction.amount.toFixed(2),
              currency: row.transaction.currency,
              transactionDate: row.transaction.transactionDate.toISOString(),
              accountName: row.transaction.account?.name ?? null,
              cardName: row.transaction.card?.name ?? null,
            }
          : null,
      })),
    };
  }

  async recordManualPayment({
    userId,
    id,
    dto,
    now,
  }: RecordManualPaymentInput) {
    const subscription = await this.repo.findById(userId, id);
    if (!subscription) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    if (dto.transactionId) {
      await this.assertTransactionLinkable(userId, id, dto.transactionId);
    }
    const payment = await this.repo.createPayment({
      subscriptionId: id,
      transactionId: dto.transactionId ?? null,
      amount: roundDecimal(dto.amount ?? subscription.amount),
      currency: dto.currency?.toUpperCase() ?? subscription.currency,
      paidAt: dto.paidAt ? new Date(dto.paidAt) : now,
      source: 'MANUAL',
    });
    if (subscription.status === 'ACTIVE') {
      await this.advanceBilling(subscription);
    }
    return {
      id: payment.id,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      paidAt: payment.paidAt.toISOString(),
      source: payment.source,
    };
  }

  async matchTransaction(input: {
    userId: string;
    transactionId: string;
  }): Promise<void> {
    const transaction = await this.repo.findTransaction(
      input.userId,
      input.transactionId,
    );
    if (!transaction || transaction.status !== 'CONFIRMED') {
      return;
    }
    if (transaction.type !== 'DEBIT') {
      return;
    }
    const active = await this.repo.findActive(input.userId);
    const candidates = active.filter((row) =>
      matchesSubscription({
        subscription: {
          id: row.id,
          normalizedKey: row.normalizedKey,
          amount: scalarNumber(row.amount),
          currency: row.currency,
          nextBillingDate: row.nextBillingDate,
        },
        transaction: {
          merchant: transaction.merchant,
          amount: scalarNumber(transaction.amount),
          currency: transaction.currency,
          transactionDate: transaction.transactionDate,
        },
      }),
    );
    if (candidates.length !== 1) {
      return;
    }
    const subscription = candidates[0];
    const existingPayment = await this.repo.findPaymentByTransaction(
      subscription.id,
      transaction.id,
    );
    if (existingPayment) {
      return;
    }
    await this.repo.createPayment({
      subscriptionId: subscription.id,
      transactionId: transaction.id,
      amount: roundDecimal(transaction.amount),
      currency: transaction.currency,
      paidAt: transaction.transactionDate,
      source: 'AUTO',
    });
    await this.advanceBilling(subscription);
  }

  private async assertTransactionLinkable(
    userId: string,
    subscriptionId: string,
    transactionId: string,
  ): Promise<void> {
    const transaction = await this.repo.findTransaction(userId, transactionId);
    if (!transaction) {
      throw new BadRequestException('Transacción no encontrada');
    }
    const alreadyLinked = await this.repo.findPaymentByTransaction(
      subscriptionId,
      transactionId,
    );
    if (alreadyLinked) {
      throw new ConflictException(
        'This movement is already registered for the subscription',
      );
    }
  }

  private async advanceBilling(subscription: SubscriptionRow): Promise<void> {
    await this.repo.update(subscription.userId, subscription.id, {
      nextBillingDate: dateOnly(
        nextBillingAfter(
          {
            anchor: subscription.anchorDate,
            cycle: subscription.billingCycle,
            interval: subscription.billingInterval,
          },
          subscription.nextBillingDate,
        ),
      ),
    });
  }
}
