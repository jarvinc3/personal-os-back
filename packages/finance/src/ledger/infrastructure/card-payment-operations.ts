import type { Prisma, PrismaService } from '@personal-os/database';
import { scalarNumber } from '../../shared/domain/money';
import {
  CARD_PAYMENT_REFERENCE_WINDOW_MS,
  type CardPaymentOperation,
} from '../application/reconcile-card-payment-import';

/**
 * Lecturas y bloqueo que comparten la ruta manual y la importación de un pago
 * de tarjeta. Viven juntas para que la decisión y la escritura usen la misma
 * transacción y el mismo bloqueo por usuario.
 */
export class CardPaymentOperations {
  constructor(private readonly prisma: PrismaService) {}

  async lock(userId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`card_payment:${userId}`}))`;
  }

  /** Cartera de pagos de tarjeta del usuario alrededor de una fecha. */
  async loadOperations(
    tx: Pick<PrismaService, 'finTransaction'>,
    userId: string,
    transactionDate: Date,
  ): Promise<CardPaymentOperation[]> {
    const sources = await tx.finTransaction.findMany({
      where: {
        userId,
        type: 'CARD_PAYMENT',
        legRole: 'SOURCE',
        status: { in: ['PENDING', 'CONFIRMED'] },
        transactionDate: {
          gte: new Date(
            transactionDate.getTime() - CARD_PAYMENT_REFERENCE_WINDOW_MS,
          ),
          lte: new Date(
            transactionDate.getTime() + CARD_PAYMENT_REFERENCE_WINDOW_MS,
          ),
        },
      },
      select: {
        id: true,
        transferGroupId: true,
        accountId: true,
        externalReference: true,
        amount: true,
        currency: true,
        transactionDate: true,
        source: true,
        description: true,
      },
    });
    const groupIds = sources.flatMap(({ transferGroupId }) =>
      transferGroupId ? [transferGroupId] : [],
    );
    if (!groupIds.length) {
      return [];
    }
    const destinations = await tx.finTransaction.findMany({
      where: {
        userId,
        type: 'CARD_PAYMENT',
        legRole: 'DESTINATION',
        transferGroupId: { in: groupIds },
      },
      select: { transferGroupId: true, cardId: true },
    });
    const cardByGroup = new Map(
      destinations.flatMap(({ transferGroupId, cardId }) =>
        transferGroupId && cardId ? [[transferGroupId, cardId] as const] : [],
      ),
    );
    return sources.flatMap((source) => {
      const cardId = source.transferGroupId
        ? cardByGroup.get(source.transferGroupId)
        : undefined;
      if (!cardId || !source.accountId || !source.transferGroupId) {
        return [];
      }
      return [
        {
          transferGroupId: source.transferGroupId,
          sourceTransactionId: source.id,
          accountId: source.accountId,
          cardId,
          externalReference: source.externalReference,
          amount: scalarNumber(source.amount),
          currency: source.currency,
          transactionDate: source.transactionDate,
          imported: source.source === 'EMAIL',
          description: source.description,
        },
      ];
    });
  }

  async findCardForPayment(
    userId: string,
    cardId: string,
  ): Promise<{ id: string; type: string; currencies: string[] } | null> {
    const card = await this.prisma.finCard.findFirst({
      where: { id: cardId, userId },
      select: {
        id: true,
        type: true,
        balances: { select: { currency: true } },
      },
    });
    if (!card) {
      return null;
    }
    return {
      id: card.id,
      type: card.type,
      currencies: card.balances.map((balance) => balance.currency),
    };
  }
}
