import { Injectable } from '@nestjs/common';
import type { LogoUploadFile } from '@personal-os/logos';
import type { CursorQueryDto } from '@personal-os/core';
import type { CreateInstitutionDto } from '../presentation/dto/create-institution.dto';
import type { UpdateInstitutionDto } from '../presentation/dto/update-institution.dto';
import { CatalogInstitutionLifecycle } from './catalog-institution-lifecycle';
import { CatalogInstitutionMutations } from './catalog-institution-mutations';
import { CatalogInstitutionReads } from './catalog-institution-reads';

/** Institutions: reads, writes and lifecycle with the same public surface. */
@Injectable()
export class CatalogInstitutionsService {
  constructor(
    private readonly reads: CatalogInstitutionReads,
    private readonly mutations: CatalogInstitutionMutations,
    private readonly lifecycle: CatalogInstitutionLifecycle,
  ) {}

  listInstitutionsPage(userId: string, query: CursorQueryDto) {
    return this.reads.listInstitutionsPage(userId, query);
  }

  lookupInstitutions(userId: string, ids: readonly string[]) {
    return this.reads.lookupInstitutions(userId, ids);
  }

  async createInstitution(userId: string, dto: CreateInstitutionDto) {
    return this.reads.presentInstitution(
      await this.mutations.createInstitution(userId, dto),
    );
  }

  async updateInstitution(
    userId: string,
    id: string,
    dto: UpdateInstitutionDto,
  ) {
    return this.reads.presentInstitution(
      await this.mutations.updateInstitution(userId, id, dto),
    );
  }

  async uploadInstitutionLogo(
    userId: string,
    id: string,
    file: LogoUploadFile | undefined,
  ) {
    return this.reads.presentInstitution(
      await this.mutations.uploadInstitutionLogo(userId, id, file),
    );
  }

  deactivateInstitution(userId: string, id: string) {
    return this.lifecycle.deactivateInstitution(userId, id);
  }

  deleteInstitution(userId: string, id: string) {
    return this.lifecycle.deleteInstitution(userId, id);
  }

  restoreInstitution(userId: string, id: string, now: Date) {
    return this.lifecycle.restoreInstitution(userId, id, now);
  }
}
