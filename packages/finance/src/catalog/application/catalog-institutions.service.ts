import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import { LogoService, normalizeDomain } from '@personal-os/logos';
import type { LogoUploadFile } from '@personal-os/logos';
import { clampPageLimit, toCursorPage } from '@personal-os/core';
import type { CursorQueryDto } from '@personal-os/core';
import type { LedgerTransactionRow } from '../../ledger/application/ports/ledger.repository.port';
import { PurgeInstrumentLedgerUseCase } from '../../ledger/application/purge-instrument-ledger.use-case';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { assertRestored } from '../../shared/application/assert-restored';
import { isCashInstitution } from '../../shared/domain/cash';
import { institutionOrderKey } from '../domain/institution-order';
import { CatalogRepository } from '../infrastructure/catalog.repository';
import type { CreateInstitutionDto } from '../presentation/dto/create-institution.dto';
import type { UpdateInstitutionDto } from '../presentation/dto/update-institution.dto';
import { CatalogViews } from './catalog-views';
import { fallbackLogos } from './catalog-fallbacks';

/** Institutions: creation, branding, archiving and the system cash rule. */
@Injectable()
export class CatalogInstitutionsService {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly purgeLedger: PurgeInstrumentLedgerUseCase,
    private readonly logos: LogoService = fallbackLogos,
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

  async createInstitution(userId: string, dto: CreateInstitutionDto) {
    this.assertNotCashInstitutionType(dto.type);
    const domain = this.normalizeInstitutionDomain(dto.domain);
    const logoPath = domain ? await this.logos.ensureLogo(domain) : null;
    try {
      const created = await this.repo.createInstitution(userId, {
        name: dto.name,
        color: dto.color,
        country: dto.country ?? 'DO',
        type: dto.type ?? 'bank',
        shortName: dto.shortName?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
        domain,
        logoPath,
      });
      return this.views.institution(created);
    } catch (error) {
      this.rethrowInstitutionNameConflict(error);
    }
  }

  async updateInstitution(
    userId: string,
    id: string,
    dto: UpdateInstitutionDto,
  ) {
    const existing = await this.repo.findInstitution(userId, id);
    if (!existing) {
      throw new NotFoundException('Institución no encontrada');
    }
    this.assertInstitutionEditable(existing);
    this.assertNotCashInstitutionType(dto.type);
    if (dto.isActive === false) {
      await this.ownership.assertInstitutionCanArchive(userId, id);
    }
    const data = await this.buildInstitutionUpdate(dto);
    try {
      const updated = await this.repo.updateInstitution(userId, id, data);
      if (!updated) {
        throw new NotFoundException('Institución no encontrada');
      }
      return this.views.institution(updated);
    } catch (error) {
      this.rethrowInstitutionNameConflict(error);
    }
  }

  async uploadInstitutionLogo(
    userId: string,
    id: string,
    file: LogoUploadFile | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo obligatorio');
    }
    const existing = await this.repo.findInstitution(userId, id);
    if (!existing) {
      throw new NotFoundException('Institución no encontrada');
    }
    this.assertInstitutionEditable(existing);
    let path: string;
    try {
      path = await this.logos.saveCustomLogo(userId, id, file);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'No se pudo guardar el logo',
      );
    }
    const updated = await this.repo.updateInstitution(userId, id, {
      customLogoPath: path,
    });
    if (!updated) {
      throw new NotFoundException('Institución no encontrada');
    }
    return this.views.institution(updated);
  }

  async deactivateInstitution(userId: string, id: string) {
    const existing = await this.repo.findInstitution(userId, id);
    if (!existing) {
      throw new NotFoundException('Institución no encontrada');
    }
    this.assertInstitutionEditable(existing);
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
    this.assertInstitutionEditable(existing);
    const movements: LedgerTransactionRow[] = [];
    const accounts = await this.repo.listAccountsByInstitution(userId, id);
    for (const account of accounts) {
      const purged = await this.purgeLedger.forAccount(userId, account.id);
      movements.push(...purged.rows);
    }
    const cards = await this.repo.listCardsByInstitution(userId, id);
    for (const card of cards) {
      const purged = await this.purgeLedger.forCard(userId, card.id);
      movements.push(...purged.rows);
    }
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

  private async buildInstitutionUpdate(
    dto: UpdateInstitutionDto,
  ): Promise<Prisma.FinInstitutionUpdateInput> {
    const institutionUpdate: Prisma.FinInstitutionUpdateInput = {
      name: dto.name,
      color: dto.color,
      country: dto.country,
      type: dto.type,
      shortName:
        dto.shortName === undefined ? undefined : dto.shortName?.trim() || null,
      sortOrder: dto.sortOrder,
      isActive: dto.isActive,
    };
    if (dto.domain !== undefined) {
      const domain = this.normalizeInstitutionDomain(dto.domain);
      institutionUpdate.domain = domain;
      institutionUpdate.logoPath = domain
        ? await this.logos.ensureLogo(domain)
        : null;
    }
    return institutionUpdate;
  }

  private assertInstitutionEditable(institution: { isSystem: boolean }) {
    if (institution.isSystem) {
      throw new ForbiddenException(
        'La institución Efectivo es de sistema: no se puede editar ni borrar',
      );
    }
  }

  private assertNotCashInstitutionType(type: string | undefined) {
    if (type !== undefined && isCashInstitution({ type })) {
      throw new BadRequestException(
        'Efectivo ya existe como institución de sistema',
      );
    }
  }

  private normalizeInstitutionDomain(
    domain: string | null | undefined,
  ): string | null {
    if (domain == null || domain.trim() === '') {
      return null;
    }
    const normalized = normalizeDomain(domain);
    if (!normalized) {
      throw new BadRequestException('Dominio inválido');
    }
    return normalized;
  }

  private rethrowInstitutionNameConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe una institución con ese nombre');
    }
    throw error;
  }
}
