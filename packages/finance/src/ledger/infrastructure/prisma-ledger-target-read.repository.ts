import { PrismaService } from '@personal-os/database';
import { normalizeCurrencyCode } from '../../shared/domain/money';
import type { BalanceAdjustmentTarget } from '../application/ports/ledger.repository.port';

/** Producto al que apunta un movimiento o un reajuste de saldo. */
export class PrismaLedgerTargetReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccountById(id: string, userId: string) {
    return this.prisma.finAccount.findFirst({
      where: { id, userId },
      select: { id: true, currency: true },
    });
  }

  async findCardLedgerContext(id: string, userId: string) {
    const card = await this.prisma.finCard.findFirst({
      where: { id, userId },
      select: {
        type: true,
        accountId: true,
        balances: { select: { currency: true } },
      },
    });
    if (!card) {
      return null;
    }
    return {
      cardType: card.type,
      accountId: card.accountId,
      currencies: card.balances.map((balance) => balance.currency),
    };
  }

  async findSavingsGoalIdByAccount(
    userId: string,
    accountId: string,
  ): Promise<string | null> {
    const goal = await this.prisma.finSavingsGoal.findFirst({
      where: { userId, accountId },
      select: { id: true },
    });
    return goal?.id ?? null;
  }

  async findBalanceAdjustmentTarget(
    userId: string,
    input: { accountId?: string; cardId?: string; currency?: string },
  ): Promise<BalanceAdjustmentTarget | null> {
    const hasAccount = Boolean(input.accountId);
    const hasCard = Boolean(input.cardId);
    if (hasAccount === hasCard) {
      return null;
    }
    if (input.accountId) {
      return this.findAccountTarget(userId, input.accountId);
    }
    if (!input.cardId || !input.currency) {
      return null;
    }
    return this.findCardTarget(userId, input.cardId, input.currency);
  }

  private async findAccountTarget(
    userId: string,
    accountId: string,
  ): Promise<BalanceAdjustmentTarget | null> {
    const account = await this.prisma.finAccount.findFirst({
      where: { id: accountId, userId },
      select: { id: true, currency: true, balance: true },
    });
    if (!account) {
      return null;
    }
    return {
      accountId: account.id,
      cardId: null,
      currency: account.currency,
      currentBalance: Number(account.balance),
    };
  }

  private async findCardTarget(
    userId: string,
    cardId: string,
    inputCurrency: string,
  ): Promise<BalanceAdjustmentTarget | null> {
    const card = await this.prisma.finCard.findFirst({
      where: { id: cardId, userId },
      select: { id: true, type: true, accountId: true },
    });
    if (!card) {
      return null;
    }
    if (card.type === 'DEBIT' && !card.accountId) {
      return null;
    }
    if (card.type === 'CREDIT' && card.accountId) {
      return null;
    }
    const currency = normalizeCurrencyCode(inputCurrency);
    const balanceRow = await this.prisma.finCardBalance.findFirst({
      where: { cardId: card.id, currency },
      select: { balance: true },
    });
    return {
      accountId: null,
      cardId: card.id,
      currency,
      currentBalance: balanceRow ? Number(balanceRow.balance) : 0,
    };
  }
}
