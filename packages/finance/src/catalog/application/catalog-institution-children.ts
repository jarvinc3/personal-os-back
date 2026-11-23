import { Injectable } from '@nestjs/common';
import type { LedgerTransactionRow } from '../../ledger/application/ports/ledger.repository.port';
import { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import { CatalogAccountRepository } from '../infrastructure/catalog-account.repository';
import { CatalogCardRepository } from '../infrastructure/catalog-card.repository';

/** Purges the ledger of every account and card of an institution. */
@Injectable()
export class CatalogInstitutionChildren {
  constructor(
    private readonly accounts: CatalogAccountRepository,
    private readonly cards: CatalogCardRepository,
    private readonly purgeLedger: PurgeInstrumentLedgerUseCase,
  ) {}

  async collectMovements(
    userId: string,
    institutionId: string,
  ): Promise<LedgerTransactionRow[]> {
    const movements: LedgerTransactionRow[] = [];
    const accounts = await this.accounts.listAccountsByInstitution(
      userId,
      institutionId,
    );
    for (const account of accounts) {
      const purged = await this.purgeLedger.forAccount(userId, account.id);
      movements.push(...purged.rows);
    }
    const cards = await this.cards.listCardsByInstitution(
      userId,
      institutionId,
    );
    for (const card of cards) {
      const purged = await this.purgeLedger.forCard(userId, card.id);
      movements.push(...purged.rows);
    }
    return movements;
  }
}
