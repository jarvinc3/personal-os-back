import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import {
  normalizeDomain,
  type LogoService,
  type LogoUploadFile,
} from '@personal-os/logos';
import type { MerchantsRepository } from '../infrastructure/merchants.repository';
import type { MerchantDirectory } from './merchant-directory';
import type { MerchantView } from './merchant-view';

type MerchantLogoDeps = {
  repo: MerchantsRepository;
  logos: LogoService;
  directory: MerchantDirectory;
};

type RegisteredDomain = {
  domain: string | null;
  logoPath: string | null;
};

/** Brand and own-upload logos of a merchant. */
export class MerchantLogos {
  private readonly repo: MerchantsRepository;
  private readonly logos: LogoService;
  private readonly directory: MerchantDirectory;

  constructor({ repo, logos, directory }: MerchantLogoDeps) {
    this.repo = repo;
    this.logos = logos;
    this.directory = directory;
  }

  async upload(input: {
    userId: string;
    id: string;
    file: LogoUploadFile | undefined;
  }): Promise<MerchantView> {
    const now = new Date();
    if (!input.file) {
      throw new BadRequestException('Archivo obligatorio');
    }
    const existing = await this.repo.findMerchantById(input.userId, input.id);
    if (!existing) {
      throw new NotFoundException('Comercio no encontrado');
    }
    let path: string;
    try {
      path = await this.logos.saveCustomLogo(
        input.userId,
        input.id,
        input.file,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'No se pudo guardar el logo',
      );
    }
    await this.repo.updateMerchant(input.userId, input.id, {
      customLogoPath: path,
    });
    return this.directory.get(input.userId, input.id, now);
  }

  /** Removes the own upload, so the brand logo can show again. */
  async delete(input: {
    userId: string;
    id: string;
    now?: Date;
  }): Promise<MerchantView> {
    const existing = await this.repo.findMerchantById(input.userId, input.id);
    if (!existing) {
      throw new NotFoundException('Comercio no encontrado');
    }
    await this.repo.updateMerchant(input.userId, input.id, {
      customLogoPath: null,
    });
    if (existing.customLogoPath) {
      await this.logos.deleteCustomLogo(existing.customLogoPath);
    }
    return this.directory.get(input.userId, input.id, input.now);
  }

  /** Normalizes the domain and ensures its brand file, like institutions do. */
  async resolveDomain(
    rawDomain: string | null | undefined,
  ): Promise<RegisteredDomain> {
    if (rawDomain == null || rawDomain.trim() === '') {
      return { domain: null, logoPath: null };
    }
    const domain = normalizeDomain(rawDomain);
    if (!domain) {
      throw new BadRequestException('Dominio inválido');
    }
    return { domain, logoPath: await this.logos.ensureLogo(domain) };
  }

  async removeCustomLogo(path: string): Promise<void> {
    await this.logos.deleteCustomLogo(path);
  }
}
