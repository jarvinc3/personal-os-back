import { Injectable, NotFoundException } from '@nestjs/common';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { assertRestored } from '../../shared/application/assert-restored';
import { CatalogInstitutionRepository } from '../infrastructure/catalog-institution.repository';
import { CatalogInstitutionLedgerPurge } from './catalog-institution-ledger-purge';
import { assertInstitutionEditable } from './catalog-institution-rules';

@Injectable()
export class CatalogInstitutionLifecycle {
  constructor(
    private readonly repo: CatalogInstitutionRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly children: CatalogInstitutionLedgerPurge,
  ) {}

  async deactivateInstitution(userId: string, id: string) {
    const existing = await this.repo.findInstitution(userId, id);
    if (!existing) {
      throw new NotFoundException('Institución no encontrada');
    }
    assertInstitutionEditable(existing);
    await this.ownership.assertInstitutionCanArchive(userId, id);
    const updated = await this.repo.updateInstitution(userId, id, {
      isActive: false,
    });
    if (!updated) {
      throw new NotFoundException('Institución no encontrada');
    }
    return { success: true };
  }

  async deleteInstitution(userId: string, id: string) {
    const existing = await this.repo.findInstitution(userId, id);
    if (!existing) {
      throw new NotFoundException('Institución no encontrada');
    }
    assertInstitutionEditable(existing);
    const movements = await this.children.purgeForInstitution(userId, id);
    const removed = await this.repo.deleteInstitution({
      userId,
      id,
      movements,
    });
    if (removed.count === 0) {
      throw new NotFoundException('Institución no encontrada');
    }
    return { success: true };
  }

  async restoreInstitution(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreInstitution(userId, id, now);
    assertRestored(restored, 'Institution not found');
    return { success: true };
  }
}
