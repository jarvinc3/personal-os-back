import { Injectable } from '@nestjs/common';
import type {
  EmailProductHints,
  EmailProductHintsPort,
} from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';

/**
 * Productos propios con últimos 4. Un correo BHD nombra cuentas y tarjetas con
 * esos dígitos, así que la clasificación necesita saber cuáles existen antes de
 * decidir si un movimiento es una compra, una transferencia o un pago de tarjeta.
 */
@Injectable()
export class FinanceEmailProductHints implements EmailProductHintsPort {
  constructor(private readonly prisma: PrismaService) {}

  async readEmailProductHints(userId: string): Promise<EmailProductHints> {
    const [cards, accounts] = await Promise.all([
      this.prisma.finCard.findMany({
        where: { userId, isActive: true, lastFour: { not: null } },
        select: { lastFour: true },
      }),
      this.prisma.finAccount.findMany({
        where: { userId, isActive: true, accountNumberLast4: { not: null } },
        select: { accountNumberLast4: true },
      }),
    ]);
    return {
      cardLast4: lastFourOf(cards.map((card) => card.lastFour)),
      accountLast4: lastFourOf(
        accounts.map((account) => account.accountNumberLast4),
      ),
    };
  }
}

function lastFourOf(values: readonly (string | null)[]): string[] {
  return values.filter((value): value is string => value !== null);
}
