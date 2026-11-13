import { Injectable } from '@nestjs/common';
import type {
  EmailProductHints,
  EmailProductHintsPort,
} from '@personal-os/contracts';
import type { FinCardType } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';

const CREDIT_CARD: FinCardType = 'CREDIT';

/**
 * Productos propios con últimos 4. Un correo BHD nombra cuentas y tarjetas con
 * esos dígitos, así que la clasificación necesita saber cuáles existen y cuáles
 * son de crédito: solo un pago a una tarjeta de crédito es un pago de tarjeta.
 */
@Injectable()
export class FinanceEmailProductHints implements EmailProductHintsPort {
  constructor(private readonly prisma: PrismaService) {}

  async readEmailProductHints(userId: string): Promise<EmailProductHints> {
    const [cards, accounts] = await Promise.all([
      this.prisma.finCard.findMany({
        where: { userId, isActive: true, lastFour: { not: null } },
        select: { lastFour: true, type: true },
      }),
      this.prisma.finAccount.findMany({
        where: { userId, isActive: true, accountNumberLast4: { not: null } },
        select: { accountNumberLast4: true },
      }),
    ]);
    return {
      creditCardLast4: lastFourOf(
        cards
          .filter((card) => card.type === CREDIT_CARD)
          .map((card) => card.lastFour),
      ),
      ownProductLast4: [
        ...lastFourOf(
          cards
            .filter((card) => card.type !== CREDIT_CARD)
            .map((card) => card.lastFour),
        ),
        ...lastFourOf(accounts.map((account) => account.accountNumberLast4)),
      ],
    };
  }
}

function lastFourOf(values: readonly (string | null)[]): string[] {
  return values.filter((value): value is string => value !== null);
}
