import { Injectable } from '@nestjs/common';
import { clampPageLimit, toCursorPage } from '@personal-os/core';
import type { CursorQueryDto } from '@personal-os/core';
import { institutionOrderKey } from '../domain/institution-order';
import { CatalogInstitutionRepository } from '../infrastructure/catalog-institution.repository';
import { CatalogViews } from './catalog-views';

/** Institutions read with their public shape: page, list and batch. */
@Injectable()
export class CatalogInstitutionReads {
  constructor(
    private readonly repo: CatalogInstitutionRepository,
    private readonly views: CatalogViews,
  ) {}

  async listInstitutionsPage(userId: string, query: CursorQueryDto) {
    const rows = await this.repo.listInstitutions(userId, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      institutionOrderKey(row),
    );
    return {
      ...page,
      items: page.items.map((item) => this.views.institution(item)),
    };
  }

  /** Same public shape as the institutions list, loaded in batch. */
  async lookupInstitutions(userId: string, ids: readonly string[]) {
    const rows = await this.repo.findInstitutionsByIds(userId, ids);
    return new Map(rows.map((row) => [row.id, this.views.institution(row)]));
  }

  /** Public institution shape for the writes, without reading it again. */
  presentInstitution(
    row: NonNullable<
      Awaited<ReturnType<CatalogInstitutionRepository['findInstitution']>>
    >,
  ) {
    return this.views.institution(row);
  }
}
