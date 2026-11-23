import { BadRequestException, Injectable } from '@nestjs/common';
import { LogoService, normalizeDomain } from '@personal-os/logos';
import type { LogoUploadFile } from '@personal-os/logos';
import { fallbackLogos } from './catalog-fallbacks';

@Injectable()
export class CatalogInstitutionBranding {
  constructor(private readonly logos: LogoService = fallbackLogos) {}

  normalize(domain: string | null | undefined): string | null {
    if (domain == null || domain.trim() === '') {
      return null;
    }
    const normalized = normalizeDomain(domain);
    if (!normalized) {
      throw new BadRequestException('Dominio inválido');
    }
    return normalized;
  }

  ensureLogo(domain: string | null): Promise<string | null> {
    if (!domain) {
      return Promise.resolve(null);
    }
    return this.logos.ensureLogo(domain);
  }

  saveCustomLogo(
    userId: string,
    id: string,
    file: LogoUploadFile,
  ): Promise<string> {
    return this.logos.saveCustomLogo(userId, id, file);
  }
}
