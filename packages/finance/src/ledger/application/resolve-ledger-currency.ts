import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ACCOUNT_NOT_FOUND,
  ACCOUNT_NOT_FOUND_MESSAGE,
  SAME_ACCOUNT,
  SAME_ACCOUNT_MESSAGE,
} from '../../shared/domain/transfer';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

export async function resolveLedgerCurrencyForTarget(
  repo: LedgerRepositoryPort,
  userId: string,
  accountId: string | undefined,
  cardId: string | undefined,
  fallbackCurrency: string,
): Promise<string> {
  if (accountId) {
    const account = await requireOwnedAccount(repo, userId, accountId);
    return account.currency;
  }
  if (cardId) {
    return fallbackCurrency;
  }
  return fallbackCurrency;
}

export async function requireOwnedAccount(
  repo: LedgerRepositoryPort,
  userId: string,
  accountId: string,
): Promise<{ id: string; currency: string }> {
  const account = await repo.findAccountById(accountId, userId);
  if (!account) {
    throw new NotFoundException({
      code: ACCOUNT_NOT_FOUND,
      message: ACCOUNT_NOT_FOUND_MESSAGE,
    });
  }
  return account;
}

export function assertDifferentAccounts(
  fromAccountId: string,
  toAccountId: string,
): void {
  if (fromAccountId === toAccountId) {
    throw new BadRequestException({
      code: SAME_ACCOUNT,
      message: SAME_ACCOUNT_MESSAGE,
    });
  }
}
