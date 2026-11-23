import { Injectable } from '@nestjs/common';
import type { LedgerTransactionRow } from '../../ledger/application/ports/ledger.repository.port';
import { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import { CatalogAccountRepository } from '../infrastructure/catalog-account.repository';
import { CatalogCardRepository } from '../infrastructure/catalog-card.repository';

@Injectable()
export class CatalogInstitutionLedgerPurge {
  constructor(
    private readonly accounts: CatalogAccountRepository,
    private readonly cards: CatalogCardRepository,
    private readonly purgeLedger: PurgeInstrumentLedgerUseCase,
  ) {}

  /** Purges the ledger rows and returns them for the deletion journal. */
  async purgeForInstitution(
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
