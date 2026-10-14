import { Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@personal-os/database';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type {
  IntegrityAccountRow,
  IntegrityCard,
  IntegrityCardBalanceRow,
  IntegrityMovement,
} from '../domain/expected-balance';

export type IntegrityTarget =
  | { accountId: string; cardId?: never; currency?: never }
  | { accountId?: never; cardId: string; currency?: string };

export type IntegritySnapshot = {
  accounts: IntegrityAccountRow[];
  cards: IntegrityCard[];
  cardBalances: IntegrityCardBalanceRow[];
  movements: IntegrityMovement[];
};

export type BalanceDriftRow = {
  id: string;
  accountId: string | null;
  cardId: string | null;
  currency: string;
  storedBalance: Prisma.Decimal;
  expectedBalance: Prisma.Decimal;
  difference: Prisma.Decimal;
  detectedAt: Date;
  resolvedAt: Date | null;
  account: { name: string } | null;
  card: { name: string } | null;
};

export type DriftWriteInput = {
  userId: string;
  target: IntegrityTarget;
  currency: string;
  storedCents: number;
  expectedCents: number;
  detectedAt: Date;
};

const OPEN_DRIFT = { resolvedAt: null } as const;

const DRIFT_INCLUDE = {
  account: { select: { name: true } },
  card: { select: { name: true } },
} satisfies Prisma.FinBalanceDriftInclude;

function decimalToCents(value: Prisma.Decimal): number {
  return value.mul(100).round().toNumber();
}

function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100);
}

function targetFilters(
  target?: IntegrityTarget,
): Prisma.FinBalanceDriftWhereInput {
  if (!target) {
    return {};
  }
  if ('accountId' in target && target.accountId) {
    return { accountId: target.accountId };
  }
  return {
    cardId: target.cardId,
    ...(target.currency
      ? { currency: normalizeCurrencyCode(target.currency) }
      : {}),
  };
}

@Injectable()
export class IntegrityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listUserIdsWithProducts(): Promise<string[]> {
    const [accounts, cards] = await Promise.all([
      this.prisma.finAccount.findMany({
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.prisma.finCard.findMany({
        distinct: ['userId'],
        select: { userId: true },
      }),
    ]);
    return [...new Set([...accounts, ...cards].map((row) => row.userId))];
  }

  async loadSnapshot(userId: string): Promise<IntegritySnapshot> {
    const [accounts, cards, cardBalances, movements] = await Promise.all([
      this.prisma.finAccount.findMany({
        where: { userId },
        select: { id: true, currency: true, balance: true },
      }),
      this.prisma.finCard.findMany({
        where: { userId },
        select: { id: true, type: true, accountId: true },
      }),
      this.prisma.finCardBalance.findMany({
        where: { card: { userId } },
        select: { id: true, cardId: true, currency: true, balance: true },
      }),
      this.prisma.finTransaction.findMany({
        where: { userId, status: 'CONFIRMED' },
        select: {
          accountId: true,
          cardId: true,
          type: true,
          ledgerAmount: true,
          ledgerCurrency: true,
        },
      }),
    ]);

    return {
      accounts: accounts.map((account) => ({
        id: account.id,
        currency: account.currency,
        balanceCents: decimalToCents(account.balance),
      })),
      cards: cards.map((card) => ({
        id: card.id,
        type: card.type,
        accountId: card.accountId,
      })),
      cardBalances: cardBalances.map((balance) => ({
        id: balance.id,
        cardId: balance.cardId,
        currency: balance.currency,
        balanceCents: decimalToCents(balance.balance),
      })),
      movements: movements.map((movement): IntegrityMovement => ({
        accountId: movement.accountId,
        cardId: movement.cardId,
        type: movement.type,
        ledgerAmountCents: decimalToCents(movement.ledgerAmount),
        ledgerCurrency: normalizeCurrencyCode(movement.ledgerCurrency),
      })),
    };
  }

  listOpenDrifts(
    userId: string,
    target?: IntegrityTarget,
  ): Promise<BalanceDriftRow[]> {
    return this.prisma.finBalanceDrift.findMany({
      where: { userId, ...OPEN_DRIFT, ...targetFilters(target) },
      include: DRIFT_INCLUDE,
      orderBy: { detectedAt: 'desc' },
    });
  }

  findOpenDrift(
    userId: string,
    target: IntegrityTarget,
    currency: string,
  ): Promise<BalanceDriftRow | null> {
    return this.prisma.finBalanceDrift.findFirst({
      where: {
        userId,
        ...OPEN_DRIFT,
        ...targetFilters(target),
        currency: normalizeCurrencyCode(currency),
      },
      include: DRIFT_INCLUDE,
    });
  }

  createDrift(input: DriftWriteInput): Promise<BalanceDriftRow> {
    const { userId, target, currency, storedCents, expectedCents } = input;
    return this.prisma.finBalanceDrift.create({
      data: {
        userId,
        accountId: 'accountId' in target ? target.accountId : null,
        cardId: 'cardId' in target ? target.cardId : null,
        currency: normalizeCurrencyCode(currency),
        storedBalance: centsToDecimal(storedCents),
        expectedBalance: centsToDecimal(expectedCents),
        difference: centsToDecimal(expectedCents - storedCents),
        detectedAt: input.detectedAt,
      },
      include: DRIFT_INCLUDE,
    });
  }

  updateDrift(
    input: DriftWriteInput & { id: string },
  ): Promise<BalanceDriftRow> {
    return this.prisma.finBalanceDrift.update({
      where: { id: input.id },
      data: {
        storedBalance: centsToDecimal(input.storedCents),
        expectedBalance: centsToDecimal(input.expectedCents),
        difference: centsToDecimal(input.expectedCents - input.storedCents),
        detectedAt: input.detectedAt,
      },
      include: DRIFT_INCLUDE,
    });
  }

  async resolveDrift(id: string, now: Date): Promise<void> {
    await this.prisma.finBalanceDrift.updateMany({
      where: { id, ...OPEN_DRIFT },
      data: { resolvedAt: now },
    });
  }

  /**
   * Corrects the stored balance and closes the open drifts in one transaction,
   * so a failed write never leaves a resolved drift with a wrong balance.
   */
  async correctBalance(input: {
    userId: string;
    target: IntegrityTarget;
    currency?: string;
    expectedCents: number;
    now: Date;
  }): Promise<void> {
    const { userId, target, expectedCents, now } = input;
    await this.prisma.$transaction(async (tx) => {
      if ('accountId' in target && target.accountId) {
        await tx.finAccount.update({
          where: { id: target.accountId },
          data: { balance: centsToDecimal(expectedCents) },
        });
      } else if ('cardId' in target && target.cardId) {
        const currency = normalizeCurrencyCode(
          input.currency ?? target.currency ?? '',
        );
        const existing = await tx.finCardBalance.findFirst({
          where: { cardId: target.cardId, currency },
        });
        if (existing) {
          await tx.finCardBalance.update({
            where: { id: existing.id },
            data: { balance: centsToDecimal(expectedCents) },
          });
        } else {
          await tx.finCardBalance.create({
            data: {
              cardId: target.cardId,
              currency,
              balance: centsToDecimal(expectedCents),
            },
          });
        }
      }
      await tx.finBalanceDrift.updateMany({
        where: {
          userId,
          ...OPEN_DRIFT,
          ...targetFilters(target),
          ...(input.currency
            ? { currency: normalizeCurrencyCode(input.currency) }
            : {}),
        },
        data: { resolvedAt: now },
      });
    });
  }
}
