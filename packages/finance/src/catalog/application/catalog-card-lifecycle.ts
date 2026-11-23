import { Injectable, NotFoundException } from '@nestjs/common';
import { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import { assertRestored } from '../../shared/application/assert-restored';
import { CatalogCardRepository } from '../infrastructure/catalog-card.repository';

/** Card lifecycle: deactivate, purge the ledger and restore. */
@Injectable()
export class CatalogCardLifecycle {
  constructor(
    private readonly repo: CatalogCardRepository,
    private readonly purgeLedger: PurgeInstrumentLedgerUseCase,
  ) {}

  async deactivateCard(userId: string, id: string) {
    const updated = await this.repo.updateCard(userId, id, { isActive: false });
    if (!updated) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return { success: true };
  }

  async deleteCard(userId: string, id: string) {
    const existing = await this.repo.findCardById(userId, id);
    if (!existing) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    const purged = await this.purgeLedger.forCard(userId, id);
    const removed = await this.repo.deleteCard({
      userId,
      id,
      movements: purged.rows,
    });
    if (removed.count === 0) {
      throw new NotFoundException('Tarjeta no encontrada');
    }
    return { success: true };
  }

  async restoreCard(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreCard(userId, id, now);
    assertRestored(restored, 'Card not found');
    return { success: true };
  }
}
