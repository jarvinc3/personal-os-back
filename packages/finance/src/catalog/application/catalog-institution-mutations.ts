import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import type { LogoUploadFile } from '@personal-os/logos';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { CatalogInstitutionRepository } from '../infrastructure/catalog-institution.repository';
import type { CreateInstitutionDto } from '../presentation/dto/create-institution.dto';
import type { UpdateInstitutionDto } from '../presentation/dto/update-institution.dto';
import { CatalogInstitutionBranding } from './catalog-institution-branding';
import {
  assertInstitutionEditable,
  assertNotCashInstitutionType,
} from './catalog-institution-rules';

/** Institution writes: creation, edition and logo upload. */
@Injectable()
export class CatalogInstitutionMutations {
  constructor(
    private readonly repo: CatalogInstitutionRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly branding: CatalogInstitutionBranding,
  ) {}

  async createInstitution(userId: string, dto: CreateInstitutionDto) {
    assertNotCashInstitutionType(dto.type);
    const domain = this.branding.normalize(dto.domain);
    const logoPath = await this.branding.ensureLogo(domain);
    try {
      return await this.repo.createInstitution(userId, {
        name: dto.name,
        color: dto.color,
        country: dto.country ?? 'DO',
        type: dto.type ?? 'bank',
        shortName: dto.shortName?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
        domain,
        logoPath,
      });
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
    assertInstitutionEditable(existing);
    assertNotCashInstitutionType(dto.type);
    if (dto.isActive === false) {
      await this.ownership.assertInstitutionCanArchive(userId, id);
    }
    const institutionUpdate = await this.buildInstitutionUpdate(dto);
    try {
      const updated = await this.repo.updateInstitution(
        userId,
        id,
        institutionUpdate,
      );
      if (!updated) {
        throw new NotFoundException('Institución no encontrada');
      }
      return updated;
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
    assertInstitutionEditable(existing);
    let path: string;
    try {
      path = await this.branding.saveCustomLogo(userId, id, file);
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
    return updated;
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
      const domain = this.branding.normalize(dto.domain);
      institutionUpdate.domain = domain;
      institutionUpdate.logoPath = await this.branding.ensureLogo(domain);
    }
    return institutionUpdate;
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
