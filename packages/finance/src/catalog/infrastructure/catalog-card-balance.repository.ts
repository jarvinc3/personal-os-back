import { Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@personal-os/database';
import { INSTRUMENT_EVENT_KIND } from '../../shared/domain/instrument-event';
import { normalizeCurrencyCode } from '../../shared/presentation/validation.decorators';

export type CardBalanceInput = {
  userId: string;
  cardId: string;
  currency: string;
  balance: number;
  creditLimit?: number;
};

export type CardCreditLimitInput = {
  userId: string;
  cardId: string;
  currency: string;
  creditLimit: number;
};

type CreditLimitChange = {
  userId: string;
  cardId: string;
  currency: string;
  previousLimit: unknown;
  nextLimit: number;
};

/** Card balances: one row per currency, with the limit change journal. */
@Injectable()
export class CatalogCardBalanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsertCardBalance({
    userId,
    cardId,
    currency,
    balance,
    creditLimit,
  }: CardBalanceInput) {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.finCard.findFirst({
        where: { id: cardId, userId },
      });
      if (!card) {
        return null;
      }
      const normalizedCurrency = String(normalizeCurrencyCode(currency));
      const existing = await tx.finCardBalance.findFirst({
        where: { cardId, currency: normalizedCurrency },
      });
      if (existing) {
        if (creditLimit !== undefined) {
          await this.recordCreditLimitChange(tx, {
            userId,
            cardId,
            currency: normalizedCurrency,
            previousLimit: existing.creditLimit,
            nextLimit: creditLimit,
          });
        }
        return tx.finCardBalance.update({
          where: { id: existing.id },
          data: {
            balance,
            ...(creditLimit !== undefined ? { creditLimit } : {}),
          },
        });
      }
      if (creditLimit !== undefined) {
        await this.recordCreditLimitChange(tx, {
          userId,
          cardId,
          currency: normalizedCurrency,
          previousLimit: null,
          nextLimit: creditLimit,
        });
      }
      return tx.finCardBalance.create({
        data: {
          cardId,
          currency: normalizedCurrency,
          balance,
          ...(creditLimit !== undefined ? { creditLimit } : {}),
        },
      });
    });
  }

  setCardCreditLimit({
    userId,
    cardId,
    currency,
    creditLimit,
  }: CardCreditLimitInput) {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.finCard.findFirst({
        where: { id: cardId, userId },
      });
      if (!card) {
        return null;
      }
      const normalizedCurrency = String(normalizeCurrencyCode(currency));
      const existing = await tx.finCardBalance.findFirst({
        where: { cardId, currency: normalizedCurrency },
      });
      if (existing) {
        await this.recordCreditLimitChange(tx, {
          userId,
          cardId,
          currency: normalizedCurrency,
          previousLimit: existing.creditLimit,
          nextLimit: creditLimit,
        });
        return tx.finCardBalance.update({
          where: { id: existing.id },
          data: { creditLimit },
        });
      }
      await this.recordCreditLimitChange(tx, {
        userId,
        cardId,
        currency: normalizedCurrency,
        previousLimit: null,
        nextLimit: creditLimit,
      });
      return tx.finCardBalance.create({
        data: {
          cardId,
          currency: normalizedCurrency,
          balance: 0,
          creditLimit,
        },
      });
    });
  }

  deleteCardBalance(userId: string, cardId: string, currency: string) {
    return this.prisma.finCardBalance.deleteMany({
      where: {
        cardId,
        currency: String(normalizeCurrencyCode(currency)),
        card: { userId },
      },
    });
  }

  private async recordCreditLimitChange(
    tx: Prisma.TransactionClient,
    input: CreditLimitChange,
  ): Promise<void> {
    const previousLimit =
      input.previousLimit === null || input.previousLimit === undefined
        ? null
        : Number(input.previousLimit);
    if (previousLimit !== null && previousLimit === input.nextLimit) {
      return;
    }
    await tx.finInstrumentEvent.create({
      data: {
        userId: input.userId,
        cardId: input.cardId,
        kind: INSTRUMENT_EVENT_KIND.CREDIT_LIMIT_CHANGED,
        payload: {
          currency: input.currency,
          previousLimit,
          nextLimit: input.nextLimit,
        },
      },
    });
  }
}
