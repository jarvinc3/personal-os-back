import { Prisma } from '@personal-os/database';
import type { FinanceWipeTx } from './finance-wipe-branch';

/**
 * Credit-card `balance` is available credit. Restoring it to the limit clears
 * the debt the balance sheet shows. Debit cards hold cash, so those rows go to
 * zero.
 */
export async function resetCardBalances(
  tx: FinanceWipeTx,
  userId: string,
  institutionId?: string,
): Promise<number> {
  const restored = await tx.$executeRaw`
    UPDATE fin_card_balances AS b
    SET balance = b.credit_limit,
        updated_at = NOW()
    FROM fin_cards AS c
    WHERE b.card_id = c.id
      AND c.user_id = ${userId}
      AND c.type = 'CREDIT'::"FinCardType"
      AND b.credit_limit IS NOT NULL
      ${
        institutionId
          ? Prisma.sql`AND c.institution_id = ${institutionId}`
          : Prisma.empty
      }
  `;
  const debits = await tx.finCardBalance.updateMany({
    where: {
      card: institutionId
        ? { userId, institutionId, type: 'DEBIT' }
        : { userId, type: 'DEBIT' },
    },
    data: { balance: 0 },
  });
  return Number(restored) + debits.count;
}
