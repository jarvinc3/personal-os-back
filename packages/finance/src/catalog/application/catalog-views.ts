import { Injectable } from '@nestjs/common';
import { LogoService } from '@personal-os/logos';
import { UsersService } from '@personal-os/users';
import { availableCredit } from '../../statements/domain/card-statement-amounts';
import { buildNextCardCycle } from '../../statements/domain/card-statement-cycle';
import { isoDay, localDayStart } from '../../shared/domain/local-day';
import {
  decimalToNullableString,
  decimalToString,
} from '../../shared/domain/mappers';
import { roundMoney } from '../../shared/domain/money';
import type { CatalogAccountRepository } from '../infrastructure/catalog-account.repository';
import type { CatalogCardRepository } from '../infrastructure/catalog-card.repository';
import type { CatalogInstitutionRepository } from '../infrastructure/catalog-institution.repository';
import { fallbackLogos, fallbackUsers } from './catalog-fallbacks';

type CardRow = NonNullable<
  Awaited<ReturnType<CatalogCardRepository['findCardById']>>
>;

function mapCardBalance(
  balance: CardRow['balances'][number],
  transactions: CardRow['transactions'],
) {
  return {
    id: balance.id,
    currency: balance.currency,
    balance: decimalToString(balance.balance),
    creditLimit: decimalToNullableString(balance.creditLimit),
    availableCredit:
      balance.creditLimit === null
        ? null
        : decimalToString(
            availableCredit({
              storedAvailable: Number(balance.balance),
              movements: transactions.filter(
                (movement) => movement.ledgerCurrency === balance.currency,
              ),
            }),
          ),
  };
}

/**
 * Public shapes of the catalog. Keeps the logo and user lookups out of the
 * services that only need to return a row.
 */
@Injectable()
export class CatalogViews {
  constructor(
    private readonly logos: LogoService = fallbackLogos,
    private readonly users: UsersService = fallbackUsers,
  ) {}
  account(
    account: NonNullable<
      Awaited<ReturnType<CatalogAccountRepository['findAccountById']>>
    >,
    earmarkedAmount = 0,
  ) {
    const freeBalance = roundMoney(Number(account.balance) - earmarkedAmount);
    return {
      id: account.id,
      institutionId: account.institutionId,
      institutionName: account.institutionRef?.name ?? null,
      institutionLogoUrl: this.logos.resolveUrl(account.institutionRef),
      institutionColor: account.institutionRef?.color ?? null,
      name: account.name,
      type: account.type,
      currency: account.currency,
      accountNumberLast4: account.accountNumberLast4,
      isDefaultForInstitution: account.isDefaultForInstitution,
      balance: decimalToString(account.balance),
      earmarkedAmount: decimalToString(earmarkedAmount),
      freeBalance: decimalToString(freeBalance),
      color: account.color,
      isActive: account.isActive,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  institution(
    institution: Awaited<
      ReturnType<CatalogInstitutionRepository['listInstitutions']>
    >[number],
  ) {
    return {
      id: institution.id,
      name: institution.name,
      type: institution.type ?? 'bank',
      shortName: institution.shortName ?? null,
      sortOrder: institution.sortOrder ?? 0,
      domain: institution.domain ?? null,
      color: institution.color,
      logoUrl: this.logos.resolveUrl(institution),
      country: institution.country,
      isActive: institution.isActive,
      isSystem: institution.isSystem,
    };
  }

  card(card: CardRow, today: Date) {
    const cycle = buildNextCardCycle({
      closingDay: card.statementClosingDay,
      dueDay: card.paymentDueDay,
      today,
    });
    return {
      id: card.id,
      institutionId: card.institutionId,
      institutionName: card.institution.name,
      institutionLogoUrl: this.logos.resolveUrl(card.institution),
      institutionColor: card.institution.color ?? null,
      networkLogoUrl: this.logos.networkLogoUrl(card.network),
      accountId: card.accountId,
      accountName: card.account?.name ?? null,
      name: card.name,
      type: card.type,
      network: card.network,
      lastFour: card.lastFour,
      statementClosingDay: card.statementClosingDay,
      paymentDueDay: card.paymentDueDay,
      nextStatementDate: cycle ? isoDay(cycle.statementDate) : null,
      nextPaymentDueDate: cycle?.paymentDueDate
        ? isoDay(cycle.paymentDueDate)
        : null,
      color: card.color,
      isActive: card.isActive,
      balances: card.balances.map((balance) =>
        mapCardBalance(balance, card.transactions),
      ),
    };
  }

  async localToday(userId: string): Promise<Date> {
    const profile = await this.users.findById(userId);
    return localDayStart(profile.timezone, new Date());
  }
}
