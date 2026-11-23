import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import { accountMatchesHint } from '../ledger/application/resolve-ledger-target-from-hints';

export type CardPaymentCardResolution =
  | { kind: 'resolved'; cardId: string; currencies: string[] }
  | { kind: 'review'; reason: string };

export type CardPaymentAccountResolution =
  | { kind: 'resolved'; accountId: string; currency: string }
  | { kind: 'review'; reason: string };

export type CardPaymentAccountCandidate = {
  id: string;
  accountNumberLast4: string | null;
  currency: string;
};

export const CARD_PAYMENT_REVIEW_REASON = {
  CARD_NOT_FOUND: 'CARD_PAYMENT_CARD_NOT_FOUND',
  CARD_AMBIGUOUS: 'CARD_PAYMENT_CARD_AMBIGUOUS',
  CARD_NOT_CREDIT: 'CARD_PAYMENT_CARD_NOT_CREDIT',
  SOURCE_ACCOUNT_NOT_FOUND: 'CARD_PAYMENT_SOURCE_ACCOUNT_NOT_FOUND',
  SOURCE_ACCOUNT_AMBIGUOUS: 'CARD_PAYMENT_SOURCE_ACCOUNT_AMBIGUOUS',
} as const;

/** Decide la tarjeta de crédito y la cuenta de origen de un pago de tarjeta. */
@Injectable()
export class CardPaymentTargets {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCard({
    userId,
    lastFour,
  }: {
    userId: string;
    lastFour: string | null;
  }): Promise<CardPaymentCardResolution> {
    if (!lastFour) {
      return {
        kind: 'review',
        reason: CARD_PAYMENT_REVIEW_REASON.CARD_NOT_FOUND,
      };
    }
    const cards = await this.prisma.finCard.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        type: true,
        lastFour: true,
        balances: { select: { currency: true } },
      },
    });
    const matches = cards.filter((card) => card.lastFour === lastFour);
    if (matches.length === 0) {
      return {
        kind: 'review',
        reason: CARD_PAYMENT_REVIEW_REASON.CARD_NOT_FOUND,
      };
    }
    if (matches.length > 1) {
      return {
        kind: 'review',
        reason: CARD_PAYMENT_REVIEW_REASON.CARD_AMBIGUOUS,
      };
    }
    if (matches[0].type !== 'CREDIT') {
      return {
        kind: 'review',
        reason: CARD_PAYMENT_REVIEW_REASON.CARD_NOT_CREDIT,
      };
    }
    return {
      kind: 'resolved',
      cardId: matches[0].id,
      currencies: matches[0].balances.map(({ currency }) => currency),
    };
  }

  async resolveChosenCard({
    userId,
    cardId,
  }: {
    userId: string;
    cardId: string;
  }): Promise<CardPaymentCardResolution> {
    const card = await this.prisma.finCard.findFirst({
      where: { id: cardId, userId, isActive: true },
      select: {
        id: true,
        type: true,
        balances: { select: { currency: true } },
      },
    });
    if (!card) {
      return {
        kind: 'review',
        reason: CARD_PAYMENT_REVIEW_REASON.CARD_NOT_FOUND,
      };
    }
    if (card.type !== 'CREDIT') {
      return {
        kind: 'review',
        reason: CARD_PAYMENT_REVIEW_REASON.CARD_NOT_CREDIT,
      };
    }
    return {
      kind: 'resolved',
      cardId: card.id,
      currencies: card.balances.map(({ currency }) => currency),
    };
  }

  resolveChosenAccount({
    accounts,
    accountId,
  }: {
    accounts: readonly CardPaymentAccountCandidate[];
    accountId: string;
  }): CardPaymentAccountResolution {
    const account = accounts.find((row) => row.id === accountId);
    if (!account) {
      return {
        kind: 'review',
        reason: CARD_PAYMENT_REVIEW_REASON.SOURCE_ACCOUNT_NOT_FOUND,
      };
    }
    return {
      kind: 'resolved',
      accountId: account.id,
      currency: account.currency,
    };
  }

  resolveAccount({
    accounts,
    accountNumberLast4,
  }: {
    accounts: readonly CardPaymentAccountCandidate[];
    accountNumberLast4: string | null;
  }): CardPaymentAccountResolution {
    if (!accountNumberLast4) {
      return {
        kind: 'review',
        reason: CARD_PAYMENT_REVIEW_REASON.SOURCE_ACCOUNT_NOT_FOUND,
      };
    }
    const matches = accounts.filter((account) =>
      accountMatchesHint(account.accountNumberLast4, accountNumberLast4),
    );
    if (matches.length === 0) {
      return {
        kind: 'review',
        reason: CARD_PAYMENT_REVIEW_REASON.SOURCE_ACCOUNT_NOT_FOUND,
      };
    }
    if (matches.length > 1) {
      return {
        kind: 'review',
        reason: CARD_PAYMENT_REVIEW_REASON.SOURCE_ACCOUNT_AMBIGUOUS,
      };
    }
    return {
      kind: 'resolved',
      accountId: matches[0].id,
      currency: matches[0].currency,
    };
  }
}
