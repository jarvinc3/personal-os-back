import { BadRequestException } from '@nestjs/common';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

export async function resolveLedgerCurrencyForTarget(
  repo: LedgerRepositoryPort,
  userId: string,
  accountId: string | undefined,
  cardId: string | undefined,
  fallbackCurrency: string,
): Promise<string> {
  if (accountId) {
    const account = await repo.findAccountById(accountId, userId);
    if (!account) throw new BadRequestException('Account not found');
    return account.currency;
  }
  if (cardId) return fallbackCurrency;
  return fallbackCurrency;
}
